import { rgbToOklab, gamutMap } from './blend/palette.js';
import { mobileFieldBackground } from './mobile-color-field.js?v=20261106_8';

const samples = new WeakMap();
const readableSources = new WeakMap();
const excluded = new WeakSet();
const set = (card, key, value) => {
    if (card.style.getPropertyValue(key) !== value) card.style.setProperty(key, value);
};

// The finished mobile color field is remembered per image URL (memory plus
// localStorage). A repeat view paints the final blend before the photo decodes,
// instead of waiting for metadata, image load and canvas sampling again.
const STORE_KEY = 'rss-mobile-blend-v1', STORE_LIMIT = 150;
const remembered = new Map();
let storeLoaded = false, storeTimer = 0;
const sourceId = img => img.getAttribute('data-thumbnail-src') || img.currentSrc || img.src || '';
function storedBlend(win, url) {
    if (!storeLoaded) {
        storeLoaded = true;
        try {
            for (const [id, entry] of JSON.parse(win.localStorage.getItem(STORE_KEY) || '[]')) {
                if (typeof entry?.key === 'string' && typeof entry.gradient === 'string') remembered.set(id, entry);
            }
        } catch { /* Storage is optional, including in private browsing. */ }
    }
    return url ? remembered.get(url) || null : null;
}
function rememberBlend(win, url, entry) {
    if (!url) return;
    remembered.delete(url); remembered.set(url, entry);
    while (remembered.size > STORE_LIMIT) remembered.delete(remembered.keys().next().value);
    if (storeTimer) return;
    storeTimer = win.setTimeout(() => {
        storeTimer = 0;
        try { win.localStorage.setItem(STORE_KEY, JSON.stringify([...remembered])); } catch { }
    }, 400);
}

// Publisher photos often taint canvas after a redirect. The image pipeline
// already supplies an inline copy with the same crop; reuse it without fetching.
export function rememberEdgeBleedSource(card, source, frame = [0, 0, 0, 0]) {
    if (source === null) {
        excluded.add(card); readableSources.delete(card);
        if (card.dataset.edgeBleed !== 'bottom') delete card.dataset.edgeBleed;
        return;
    }
    excluded.delete(card);
    if (!source?.startsWith('data:image/')) { readableSources.delete(card); return; }
    if (readableSources.get(card)?.source === source) return;
    const img = new card.ownerDocument.defaultView.Image();
    const entry = { source, img, frame }; readableSources.set(card, entry);
    img.onload = () => {
        if (readableSources.get(card) !== entry || !card.isConnected) return;
        const mobile = card.ownerDocument.defaultView.innerWidth < 768 && card.dataset.mobileClean === '1';
        if (mobile || card.dataset.smartHeroExtent) applyEdgeBleed(card, mobile ? 'bottom' : 'left');
    };
    img.src = source;
}

// Keep neighboring edge colors in their original order, rather than choosing
// one dominant hue for an entire side. Alpha never contributes a black fringe.
export function edgeBleedPalette(data, width, height, axis) {
    const colors = [];
    for (let band = 0; band < 6; band++) {
        const sum = [0, 0, 0];
        let weight = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const along = axis === 'bottom' ? x / width : y / height;
            const across = axis === 'bottom' ? y / height : x / width;
            if (Math.floor(along * 6) !== band || (axis === 'bottom'
                ? across < .84 || across > .94 : across < .10 || across > .30)) continue;
            const i = (y * width + x) * 4, alpha = data[i + 3] / 255;
            rgbToOklab(data[i], data[i + 1], data[i + 2]).forEach((v, c) => sum[c] += v * alpha);
            weight += alpha;
        }
        if (!weight) continue;
        const [L, a, b] = sum.map(v => v / weight);
        const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
        const color = gamutMap(.86 + .10 * L, Math.min(.06, Math.hypot(a, b) * .65), hue);
        colors.push(`oklch(${color.L.toFixed(4)} ${color.C.toFixed(5)} ${hue.toFixed(2)}) ${((band + .5) / 6 * 100).toFixed(2)}%`);
    }
    return colors.length ? `linear-gradient(to ${axis === 'bottom' ? 'right' : 'bottom'} in oklab, ${colors.join(', ')})` : null;
}

// Consume final rendered geometry, including cover cropping and mobile face
// framing. No observer, image fetch, focus change or full-resolution readback.
export function applyEdgeBleed(card, axis) {
    if (excluded.has(card) && axis !== 'bottom') { delete card.dataset.edgeBleed; return; }
    const soft = card.querySelector('.thumbnail-soft');
    const img = axis === 'left' && card.dataset.storyPhoto === 'cropped' && soft?.complete && soft.naturalWidth
        ? soft : card.querySelector('.thumbnail-img');
    const hero = card.querySelector('.article-card-image');
    const win = card.ownerDocument.defaultView;
    const url = axis === 'bottom' && img ? sourceId(img) : '';
    if (!img?.complete || !img.naturalWidth || !hero || card.dataset.storyImageMissing === 'true') {
        // Before the photo decodes, show the last finished blend for this URL.
        const previous = hero && card.dataset.storyImageMissing !== 'true' ? storedBlend(win, url) : null;
        if (previous) {
            set(card, '--edge-bleed-background', previous.gradient);
            if (card.dataset.edgeBleed !== axis) card.dataset.edgeBleed = axis;
        } else delete card.dataset.edgeBleed;
        return;
    }
    const css = win.getComputedStyle(img);
    const cr = card.getBoundingClientRect(), ir = img.getBoundingClientRect(), hr = hero.getBoundingClientRect();
    const left = Math.max(ir.left, hr.left, cr.left + card.clientLeft);
    const top = Math.max(ir.top, hr.top, cr.top + card.clientTop);
    const right = Math.min(ir.right, hr.right, cr.right - card.clientLeft);
    const bottom = Math.min(ir.bottom, hr.bottom, cr.bottom - card.clientTop);
    if (right <= left || bottom <= top) { delete card.dataset.edgeBleed; return; }
    const scale = (css.objectFit === 'contain' ? Math.min : Math.max)(ir.width / img.naturalWidth, ir.height / img.naturalHeight);
    const position = css.objectPosition.split(' ').map(parseFloat);
    const offsetX = (ir.width - img.naturalWidth * scale) * (position[0] / 100);
    const offsetY = (ir.height - img.naturalHeight * scale) * (position[1] / 100);
    const crop = [(left - ir.left - offsetX) / scale, (top - ir.top - offsetY) / scale,
        (right - left) / scale, (bottom - top) / scale];
    const readableEntry = readableSources.get(card), readable = readableEntry?.img;
    const source = readable?.complete && readable.naturalWidth ? readable : img;
    const geometry = { photoHeight: bottom - cr.top, cardHeight: cr.height };
    const key = [axis, ...crop, ...(axis === 'bottom' ? Object.values(geometry) : [])].join('|');
    const displayedSource = img.currentSrc || img.src;
    let cached = samples.get(img);
    const persistentKey = [axis, ...crop.map(Math.round), ...Object.values(geometry).map(Math.round)].join('|');
    const previous = url ? storedBlend(win, url) : null;
    if ((cached?.key !== key || cached.source !== source || cached.displayedSource !== displayedSource) && previous?.key === persistentKey) {
        cached = { key, source, displayedSource, gradient: previous.gradient }; samples.set(img, cached);
    }
    if (cached?.key !== key || cached.source !== source || cached.displayedSource !== displayedSource) {
        try {
            const canvas = card.ownerDocument.createElement('canvas'); canvas.width = canvas.height = 32;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            // Inline assets remove intentional artwork borders. Map the original
            // mobile photo into that crop before sampling its visible edge.
            const [l, t, r, b] = source !== img && displayedSource !== source.src
                ? readableEntry.frame : [0, 0, 0, 0];
            const rx = source.naturalWidth / (img.naturalWidth * (1 - l - r));
            const ry = source.naturalHeight / (img.naturalHeight * (1 - t - b));
            ctx.drawImage(source, (crop[0] - l * img.naturalWidth) * rx, (crop[1] - t * img.naturalHeight) * ry,
                crop[2] * rx, crop[3] * ry, 0, 0, 32, 32);
            const data = ctx.getImageData(0, 0, 32, 32).data;
            const gradient = axis === 'bottom' ? mobileFieldBackground(canvas, data, 32, 32, geometry)
                : edgeBleedPalette(data, 32, 32, axis);
            if (!gradient) { delete card.dataset.edgeBleed; return; }
            cached = { key, source, displayedSource, gradient }; samples.set(img, cached);
            if (url) rememberBlend(win, url, { key: persistentKey, gradient });
        } catch { delete card.dataset.edgeBleed; return; }
    }
    const fade = 'linear-gradient(to right, var(--field-neutral), color-mix(in oklab, var(--field-neutral) 55%, transparent) 32%, transparent 65%)';
    set(card, '--edge-bleed-background', axis === 'bottom' ? cached.gradient : `${fade}, ${cached.gradient}`);
    if (card.dataset.edgeBleed !== axis) card.dataset.edgeBleed = axis;
}

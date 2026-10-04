import { frameMobilePhoto } from './mobile-photo-framing.js?v=20261004_fill_1';
// Mobile Smart Top owns only presentation; palette, focus and coverage data stay upstream.
export const MOBILE_TOP = Object.freeze({
    MOBILE_BREAKPOINT: 767, META_TOP: 20, META_LEFT: 20, META_GAP: 7,
    RANK_WIDTH: 28, RANK_HEIGHT: 26, META_ITEM_HEIGHT: 26, META_ROW_HEIGHT: 28,
    IMAGE_FEATHER_EDGE: 94, IMAGE_FEATHER_WAVE: .25, IMAGE_FEATHER_SOFTNESS: 5,
    TITLE_LIFT: 20, TITLE_TOP_PADDING: 14, COVERAGE_GAP: 8,
});
const selector = '.theme-glass-light #scroll-container .article-card[data-story-blend]:is([data-image-layout="top"], [data-image-layout="standard"])';
const set = (node, key, value) => {
    if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value);
};
export function directImageMask(width, height) {
    const c = MOBILE_TOP, edge = height * c.IMAGE_FEATHER_EDGE / 100;
    const wave = height * c.IMAGE_FEATHER_WAVE / 100;
    // Nested alpha contours approximate a soft blur without SVG filter clipping at
    // the viewport edges (some rasterizers blur the otherwise opaque top/left).
    const layers = 48;
    let paths = '', previous = 0;
    for (let i = 1; i <= layers; i++) {
        const progress = i / layers;
        const alpha = progress * progress * (3 - 2 * progress);
        const opacity = (alpha - previous) / (1 - previous);
        const offset = Math.min(c.IMAGE_FEATHER_SOFTNESS, height * .02) * (1 - 4 * progress);
        const y = v => (edge + wave * v + offset).toFixed(2);
        paths += `<path fill="white" fill-opacity="${opacity.toFixed(5)}" d="M -60 -60 H ${width+60} V ${y(.3)} C ${width*.9} ${y(.3)}, ${width*.85} ${y(-.7)}, ${width*.76} ${y(-.5)} S ${width*.62} ${y(.8)}, ${width*.51} ${y(.1)} S ${width*.38} ${y(.8)}, ${width*.32} ${y(.5)} S ${width*.21} ${y(-.8)}, ${width*.14} ${y(-.4)} S 0 ${y(.6)}, -60 ${y(.4)} Z"/>`;
        previous = alpha;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function classify(metadata) {
    for (const node of metadata.querySelectorAll('span, a, div, button')) {
        let role = '';
        if (/^[•·]$/.test(node.textContent.trim())) role = 'separator';
        else if (node.parentElement === metadata) {
            if (node.matches('a') || node.querySelector('img')) role = 'source';
            else if (node.matches('div')) role = 'group';
            else role = 'item';
        } else if (node.parentElement?.dataset.mobileMetaRole === 'group') role = 'item';
        if (role && node.dataset.mobileMetaRole !== role) node.dataset.mobileMetaRole = role;
    }
}
export function mountMobileTopLayout(root = document.querySelector('#scroll-container')) {
    if (!root) return () => {};
    const win = root.ownerDocument.defaultView;
    const media = win.matchMedia(`(max-width: ${MOBILE_TOP.MOBILE_BREAKPOINT}px)`);
    const active = new Set(), masks = new WeakMap();
    let frame = 0;
    const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    function clear(card) {
        delete card.dataset.mobileClean;
        delete card.dataset.mobileFramed;
        for (const key of [...card.style]) if (key.startsWith('--mobile-') || key === '--direct-image-mask') card.style.removeProperty(key);
        for (const node of card.querySelectorAll('[data-mobile-meta-role]')) delete node.dataset.mobileMetaRole;
        resize.unobserve(card);
        for (const node of card.querySelectorAll('.article-metadata, .story-coverage-orbs')) resize.unobserve(node);
        active.delete(card); masks.delete(card);
    }
    function update() {
        frame = 0;
        for (const card of active) if (!media.matches || !card.isConnected || !card.matches(selector)) clear(card);
        if (!media.matches) return;
        for (const card of root.querySelectorAll(selector)) {
            if (!active.has(card)) {
                active.add(card); card.dataset.mobileClean = '1'; resize.observe(card);
                for (const [key, value] of Object.entries(MOBILE_TOP)) {
                    set(card, `--mobile-${key.toLowerCase().replaceAll('_', '-')}`, `${value}px`);
                }
            }
            const header = card.querySelector('.article-card-header');
            const metadata = card.querySelector('.article-metadata');
            const hero = card.querySelector('.article-card-image');
            if (!header || !metadata || !hero) continue;
            classify(metadata); resize.observe(metadata);
            const rank = card.querySelector('.story-rank');
            const hasRank = rank?.getClientRects().length > 0;
            set(card, '--mobile-meta-start', `${MOBILE_TOP.META_LEFT + (hasRank ? MOBILE_TOP.RANK_WIDTH + MOBILE_TOP.META_GAP : 0)}px`);
            frameMobilePhoto(card);
            const width = hero.clientWidth, height = hero.clientHeight;
            const key = `${width}/${height}`;
            if (width && height && masks.get(card) !== key) {
                set(card, '--mobile-mask-width', `${width}px`);
                set(card, '--mobile-mask-height', `${height}px`);
                set(card, '--direct-image-mask', directImageMask(width, height)); masks.set(card, key);
            }
            const coverage = card.querySelector('.story-coverage-orbs');
            if (!coverage) continue;
            resize.observe(coverage);
            const hr = header.getBoundingClientRect(), mr = metadata.getBoundingClientRect();
            const visible = [...coverage.children].filter(n => n.matches('.story-coverage-orb') && win.getComputedStyle(n).display !== 'none');
            // Reserve a compact overlapping stack; source labels flex before time/count do.
            const items = [...metadata.querySelectorAll('[data-mobile-meta-role="source"], [data-mobile-meta-role="item"]')]
                .filter(node => node.getClientRects().length);
            const minimumMetadata = items.reduce((sum, node) => sum + (node.dataset.mobileMetaRole === 'source' ? 38 : node.getBoundingClientRect().width), 0)
                + Math.max(0, items.length - 1) * MOBILE_TOP.META_GAP;
            const available = hr.width - MOBILE_TOP.META_LEFT * 2 - (hasRank ? MOBILE_TOP.RANK_WIDTH + MOBILE_TOP.META_GAP : 0)
                - minimumMetadata - MOBILE_TOP.COVERAGE_GAP;
            const stackWidth = Math.min(29 + (visible.length - 1) * 14, hr.width < 400 ? 57 : Infinity);
            const fitWidth = available >= 29 ? 29 + Math.floor((available - 29) / 14) * 14 : 0;
            const reserve = coverage.getClientRects().length && visible.length ? Math.min(stackWidth, fitWidth) : 0;
            set(card, '--mobile-coverage-reserve', `${reserve ? reserve + MOBILE_TOP.COVERAGE_GAP : 0}px`);
            const left = Math.min(mr.right - hr.left + MOBILE_TOP.COVERAGE_GAP, hr.width - MOBILE_TOP.META_LEFT - reserve);
            set(card, '--mobile-coverage-left', `${Math.max(MOBILE_TOP.META_LEFT, left)}px`);
            set(card, '--mobile-coverage-top', `${mr.top - hr.top + mr.height / 2}px`);
            set(card, '--mobile-coverage-width', `${reserve}px`);
        }
    }
    const observer = new MutationObserver(records => {
        if (records.some(r => r.type !== 'attributes' || r.attributeName !== 'style'
            || r.target.closest('.article-metadata, .story-coverage-orbs'))) schedule();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['data-image-layout', 'data-story-blend', 'data-focus-state', 'class', 'style'] });
    // Theme changes are outside the card tree.
    const theme = new MutationObserver(schedule);
    theme.observe(root.ownerDocument.body, { attributes: true, attributeFilter: ['class'] });
    media.addEventListener('change', schedule);
    schedule();
    return () => { observer.disconnect(); theme.disconnect(); resize.disconnect(); media.removeEventListener('change', schedule); win.cancelAnimationFrame(frame); for (const card of active) clear(card); };
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountMobileTopLayout(), { once: true });
    else mountMobileTopLayout();
}

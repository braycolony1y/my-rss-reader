import { rememberMobileSubject } from '../mobile-photo-framing.js?v=20261004_fill_1';
import { updateSharedCardStyle, rememberSharedProperties } from '../../shared-card-style/runtime.js?v=20261004_fill_1';
import { scheduleHeroExtent } from '../hero-extent.js?v=20261004_continuation_1';
import { deriveStoryTokens } from './tokens.js';
import { placeStoryHero, smoothMask } from './placement.js?v=20261006_requirements_2';
import { clamp } from './palette.js';
import { deriveStoryComposition, storyPhotoSource } from './composition.js?v=20261004_fill_1';
import { intrinsicPhotoAnalysis } from './desktop-photo.js?v=20261003_organic_1';
const cards = new WeakMap();
const asset = value => typeof value === 'string' && value.length < 800000 && /^data:image\/webp;base64,[a-zA-Z0-9+/=]+$/.test(value) ? value : '';
const set = (el, key, value) => { if (el.style.getPropertyValue(key) !== value) el.style.setProperty(key, value); };
const rgba = (color, alpha) => `color-mix(in oklab, ${color} ${alpha * 100}%, transparent)`;
const fallback = (img, focus) => ({ w: img.naturalWidth || 800, h: img.naturalHeight || 450,
    focal: { x: focus?.x ?? .5, y: focus?.y ?? .4, w: .18, h: .18, kind: 'default' },
    busyness: 0, clusters: [], avgL: .7, meanChroma: 0, hMean: 250, hueCoherence: 1,
    bottomBand: { L: .8, C: 0, H: 250 }, graphic: false });
function avatarLuminance(a, p, rect, width) {
    const grid = a.luminanceMap;
    if (!grid) return .4;
    const left = width - p.heroW;
    let total = 0, count = 0;
    for (let y = rect.top; y < rect.bottom; y += (rect.bottom - rect.top) / 6 || 1) for (let x = rect.left; x < rect.right; x += (rect.right - rect.left) / 12 || 1) {
        const sx = (x - left - p.offsetX) / p.imageW, sy = (y - p.offsetY) / p.imageH;
        if (sx < 0 || sx > 1 || sy < 0 || sy > 1) continue;
        total += grid.values[Math.min(grid.h - 1, Math.floor(sy * grid.h)) * grid.w + Math.min(grid.w - 1, Math.floor(sx * grid.w))] / 255; count++;
    }
    return count ? total / count : .4;
}
function geometry(card, analysis, img) {
    const cr = card.getBoundingClientRect(), width = card.clientWidth, height = card.clientHeight;
    const shell = card.querySelector('.story-analysis-shell')?.getBoundingClientRect();
    const heading = card.querySelector('.article-card-heading')?.getBoundingClientRect();
    const orbs = card.querySelector('.story-coverage-orbs')?.getBoundingClientRect();
    const heroTop = width < 640 && heading ? heading.bottom - cr.top : 0;
    const avatar = orbs?.width ? { left: (orbs.left - cr.left) / width, right: (orbs.right - cr.left) / width,
        top: (orbs.top - cr.top - heroTop) / height, bottom: (orbs.bottom - cr.top - heroTop) / height } : { left: .75, top: -.12, right: .99, bottom: 0 };
    const panelTop = shell?.height ? (shell.top - cr.top) / height : .64;
    const photo = intrinsicPhotoAnalysis(analysis, img);
    const p = placeStoryHero(photo, { width, height, panelTop, avatar, headingRight: heading?.width ? heading.width / width : .54 });
    return { p, width, height, panelTop, avatar, heroTop };
}
export function applyTopStoryImage(img, state, { ready = true, isDefault = false, forceLight = true } = {}) {
    const card = img.closest('.article-card');
    const shared = updateSharedCardStyle(card);
    if (card) scheduleHeroExtent(card);
    if (!card?.closest('.theme-glass-light') || (card.dataset.imageLayout !== 'top' && !shared)) return false;
    const previous = cards.get(card);
    const analysis = isDefault ? fallback(img) : state.blend?.story || state.focus?.topStoryBlend
        || (previous?.source === state.source ? previous.analysis : null) || fallback(img, state.focus);
    rememberMobileSubject(img, analysis, state.focus);
    const source = state.source || img.currentSrc || img.src;
    const g = geometry(card, analysis, img);
    if (g.width <= 0 || g.height <= 0) return true;
    const { p, width, height, panelTop, avatar } = g;
    const tokens = deriveStoryTokens(analysis, { forceLight });
    const css = { ...tokens.css, ...deriveStoryComposition(analysis, g),
        '--glass-bg': rgba('var(--panel-tint)', .70), '--glass-border': `rgb(255 255 255 / ${tokens.style === 'dark' ? .14 : .7})`,
        '--ink-2': 'var(--ink-muted)', '--accent': 'var(--accent-text)',
        '--focal-x': `${analysis.focal.x * 100}%`, '--focal-y': `${analysis.focal.y * 100}%`,
        '--hero-w': `${p.heroW.toFixed(2)}px`, '--hero-top': `${g.heroTop.toFixed(2)}px`, '--hero-h': `${p.heroH.toFixed(2)}px`,
        '--hero-photo-w': `${p.imageW.toFixed(2)}px`, '--hero-photo-h': `${p.imageH.toFixed(2)}px`,
        '--hero-photo-x': `${p.offsetX.toFixed(2)}px`, '--hero-photo-y': `${p.offsetY.toFixed(2)}px`,
        '--hero-pos': `${p.posX.toFixed(2)}% ${p.posY.toFixed(2)}%`, '--hero-scale': String(p.scale),
        '--mask-h': p.maskH, '--mask-v': p.maskV, '--panel-top': `${panelTop * 100}%`,
        '--ambient-blur': analysis.graphic ? '60px' : '70px',
        '--hero-opacity': '1',
        '--scrim-solid-end': `${Math.max(0,p.clearStart-.08)*100}%`, '--scrim-clear-at': `${p.clearStart*100}%`,
        '--bottom-start': `${Math.max(0, p.meltStart - .04 - (tokens.luminanceGap ? .06 : 0)) * 100}%`,
        '--bottom-end-opacity': tokens.luminanceGap ? '90%' : '100%',
        '--blur-mask-y': smoothMask('bottom', clamp(p.meltStart * height / p.heroH, .4, .90), .98),
        '--thumb': 'none'
    };
    const ambient = asset(analysis.assets?.ambientImage), hero = asset(analysis.assets?.heroImage);
    if (!isDefault && ambient) css['--thumb'] = `url("${ambient}")`;
    else if (!isDefault && /^(https?:|\/public\/|\/api\/)/.test(source)) css['--thumb'] = `url(${JSON.stringify(source)})`;
    const photoLeft = width - p.heroW + p.offsetX;
    const blobs = analysis.clusters.filter(c => c.C >= .04 && c.pop >= .08).slice(0, 3).map(c =>
        `radial-gradient(ellipse at ${((photoLeft + c.x * p.imageW) / width * 100).toFixed(2)}% ${((p.offsetY + c.y * p.imageH) / height * 100).toFixed(2)}%, oklch(${c.L.toFixed(3)} ${c.C.toFixed(4)} ${c.H.toFixed(2)} / .45), transparent 60%)`);
    css['--blobs'] = blobs.join(', ') || `radial-gradient(ellipse at 70% 25%, ${rgba('var(--accent-text)', .16)}, transparent 70%)`;
    const avatarLum = avatarLuminance(analysis, p, { left: avatar.left * width, right: avatar.right * width, top: avatar.top * height, bottom: avatar.bottom * height }, width);
    css['--avatar-shadow'] = avatarLum > .6 ? '0 2px 8px rgb(0 0 0 / .28), 0 0 0 1px rgb(0 0 0 / .08)' : '0 2px 6px rgb(0 0 0 / .18)';
    css['--avatar-zone-guard'] = rgba('var(--ink)', avatarLum > .75 ? .08 : 0);
    card.style.removeProperty('--subject-scrim-mask');
    const footerNode = [...card.querySelectorAll('.story-freshness')].find(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height);
    let footer;
    if (footerNode) { const range = card.ownerDocument.createRange(); range.selectNodeContents(footerNode); footer = range.getBoundingClientRect(); }
    const cr = card.getBoundingClientRect();
    css['--footer-scrim'] = footer ? `radial-gradient(ellipse ${(footer.width * .85 + 40).toFixed(2)}px ${(footer.height * 4).toFixed(2)}px at ${((footer.left - cr.left + footer.width / 2) / width * 100).toFixed(2)}% ${((footer.top - cr.top + footer.height / 2) / height * 100).toFixed(2)}%, ${rgba('var(--scrim-left)', .95)} 60%, transparent 100%)` : 'none';
    if (shared) rememberSharedProperties(card, css);
    for (const [key, value] of Object.entries(css)) set(card, key, value);
    const soft = card.querySelector('.thumbnail-soft');
    if (soft) {
        if (!soft.dataset.storyBlendWatched) {
            soft.dataset.storyBlendWatched = 'true';
            soft.addEventListener('load', () => {
                const current = cards.get(card);
                if (current) applyTopStoryImage(current.img, current.state, { ready: current.img.complete && current.img.naturalWidth > 0,
                    isDefault: current.isDefault, forceLight: current.forceLight });
            });
        }
        const next = state.near !== false && !isDefault ? storyPhotoSource(img, analysis, hero) : '';
        // The existing soft layer is hidden until its decoded asset is ready.
        // Lazy loading cannot start for a hidden image, so load nearby assets
        // eagerly while retaining the viewport gate for offscreen cards.
        if (next) soft.loading = 'eager';
        if (next && soft.getAttribute('src') !== next) soft.src = next;
        else if (!next && soft.hasAttribute('src')) soft.removeAttribute('src');
    }
    card.dataset.storyBlend = hero && soft?.getAttribute('src') && soft.complete && soft.naturalWidth ? 'ready' : 'fallback';
    card.dataset.storyBlendStyle = tokens.style;
    card.dataset.storyHeroMode = p.mode;
    card.dataset.storyHeroPlacement = p.placement;
    card.dataset.storyPhoto = analysis.crop?.some(value => value > 0) ? 'cropped' : 'original';
    card.dataset.storyBlendNear = String(state.near !== false);
    card.dataset.storyImageMissing = String(img.complete && !img.naturalWidth);
    if (ready && state.settled) { img.dataset.focusState = 'ready'; state.shown = true; }
    cards.set(card, { analysis, source, geometry: g, tokens, avatarZoneLum: avatarLum, img, state, isDefault, forceLight });
    return true;
}
export function storyBlendState(card) { return cards.get(card); }

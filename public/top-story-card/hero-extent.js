import { applyBottomEdgeColor } from './edge-colors.js?v=20261004_continuation_1';
// Consume resolved Smart Top placement; never change its focus or horizontal box.
// The image lifecycle calls this after its normal placement/palette update.
const pending = new Set();
let frame = 0;
const set = (node, key, value) => {
    if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value);
};
export function scheduleHeroExtent(card) {
    const win = card.ownerDocument.defaultView;
    if (!win?.requestAnimationFrame) return;
    pending.add(card);
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
        frame = 0;
        const measurements = [...pending].map(measure);
        pending.clear();
        measurements.forEach(commit);
    });
}
function measure(card) {
    const win = card.ownerDocument.defaultView;
    // data-image-layout is produced by usesTopStories (smart filter + top tab).
    // Also require the actual Smart article identity and desktop photo layout.
    const enabled = card.isConnected && win.innerWidth >= 768 && card.clientWidth >= 640
        && ((card.dataset.imageLayout === 'top' && !!card.dataset.smartClusterId) || card.dataset.sharedCardStyle === 'desktop')
        && !!card.closest('.theme-glass-light') && card.dataset.storyHeroPlacement === 'editorial';
    if (!enabled) return { card };
    const hero = card.querySelector('.article-card-image');
    const img = hero?.querySelector('.thumbnail-img');
    const plate = hero?.querySelector('.thumbnail-plate');
    if (!img || !plate) return { card };
    const panel = [...card.querySelectorAll('.story-analysis-shell')].find(node => {
        const rect = node.getBoundingClientRect();
        const css = win.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && css.visibility !== 'hidden' && css.display !== 'none';
    });
    const bottom = panel ? panel.getBoundingClientRect().top + 18 : card.getBoundingClientRect().bottom;
    const soft = hero.querySelector('.thumbnail-soft');
    const css = win.getComputedStyle(img);
    const position = css.getPropertyValue('--hero-pos').trim() || css.objectPosition;
    // All reads precede writes. Absolute boxes cannot move the reference panel.
    const heights = [hero, plate, img, soft].filter(Boolean).map(node => {
        const rect = node.getBoundingClientRect();
        // A hidden soft copy has no rect; its top is the sharp copy's top.
        const top = rect.width ? rect.top : img.getBoundingClientRect().top;
        return [node, `${Math.max(1, bottom - top).toFixed(3)}px`];
    });
    return { card, heights, position, mode: panel ? 'analysis' : 'card-bottom-no-feather' };
}
function commit({ card, heights, position, mode }) {
    if (!heights) {
        delete card.dataset.smartHeroExtent;
        return;
    }
    for (const [node, height] of heights) set(node, '--smart-hero-height', height);
    set(card, '--smart-hero-focus', position);
    if (card.dataset.smartHeroExtent !== mode) card.dataset.smartHeroExtent = mode;
    applyBottomEdgeColor(card);
}

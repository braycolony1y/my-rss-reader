import { updateBlendGeometry } from './card-blend/runtime.js';
// Header geometry is independent of every expandable panel in Light mode.
export function fitCardImageViewport(img) {
    const card = img.closest('.article-card'), viewport = img.closest('.article-card-image') || img.parentElement;
    const heading = card?.querySelector('.article-card-heading');
    const header = card?.querySelector('.article-card-header');
    if (header && card.closest('.theme-glass-light') && header.getBoundingClientRect().height > 0) {
        updateBlendGeometry(card);
        viewport.style.removeProperty('--image-focus-height');
        const height = `${header.getBoundingClientRect().height.toFixed(2)}px`;
        if (card.style.getPropertyValue('--liquid-header-height') !== height) card.style.setProperty('--liquid-header-height', height);
        return;
    }
    // Preserve the legacy geometry outside the Light-mode card component.
    if (card?.dataset.imageLayout !== 'top' || !heading) { viewport.style.removeProperty('--image-focus-height'); return; }
    const cardRect = card.getBoundingClientRect();
    let bottom = heading.getBoundingClientRect().bottom + 8;
    for (const panel of card.querySelectorAll('.article-briefing > *')) {
        const rect = panel.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (panel.matches('.story-analysis-shell')) { bottom = rect.top + 100; break; }
        bottom = Math.max(bottom, rect.bottom + 8);
    }
    const height = `${Math.max(1, Math.min(card.clientHeight, bottom-cardRect.top)).toFixed(2)}px`;
    if (viewport.style.getPropertyValue('--image-focus-height') !== height) viewport.style.setProperty('--image-focus-height',height);
}
export function visiblePhotoHeight(img) {
    const card = img.closest('.article-card');
    if (card?.closest('.theme-glass-light') && card.querySelector('.article-card-header')) return img.clientHeight;
    const analysis = card?.dataset.imageLayout === 'top' && card.querySelector('.story-analysis-shell');
    return analysis && analysis.getBoundingClientRect().height > 0
        ? Math.min(img.clientHeight, analysis.getBoundingClientRect().top-img.getBoundingClientRect().top) : img.clientHeight;
}

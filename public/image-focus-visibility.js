import {updateSharedCardStyle} from './shared-card-style/runtime.js?v=20261004_fill_1';
// A new offscreen photo has no visible geometry to maintain yet. Intersection
// admission runs well ahead of the viewport; previously shown cards still get
// resize/theme updates so returning to them preserves their placement.
export function shouldApplyImageFocus(state,img) {
    if(state.near !== false || state.shown === true)return true;
    // This attribute also controls text wrapping and card height. Establish it
    // even offscreen, before deferring only the expensive photo geometry.
    const card=img.closest('.article-card');
    if(updateSharedCardStyle(card)&&!card.dataset.storyBlend)card.dataset.storyBlend='fallback';
    return false;
}
export const imageFocusIntersectionOptions = doc => ({root:doc.getElementById('scroll-container'),rootMargin:'1600px 0px'});

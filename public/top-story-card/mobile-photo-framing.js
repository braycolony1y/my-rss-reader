// Focal coordinates stay image-derived. This module chooses a visible placement
// around the actual metadata rail rather than aiming at a covered image center.
const subjects = new WeakMap();
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function rememberMobileSubject(img, analysis, focus) {
    const focal = analysis.focal;
    const bounds = focus?.bounds || (focal?.kind === 'face' || focus?.type === 'face' ? {
        left: focal.x - focal.w / 2, right: focal.x + focal.w / 2,
        top: focal.y - focal.h / 2, bottom: focal.y + focal.h / 2,
    } : null);
    subjects.set(img, { bounds, x: focal?.x ?? .5, y: focal?.y ?? .5 });
}
// Every mobile card photo has the same height, whatever the source aspect ratio.
// Keep this formula identical to `--mobile-photo-fixed` in mobile-top-layout.css.
export const MOBILE_PHOTO_HEIGHT = Object.freeze({ min: 240, max: 280, vw: .62 });
export const mobilePhotoHeight = viewportWidth => Math.round(clamp((viewportWidth || 0) * MOBILE_PHOTO_HEIGHT.vw, MOBILE_PHOTO_HEIGHT.min, MOBILE_PHOTO_HEIGHT.max));
export function placeMobilePhoto({ sourceWidth, sourceHeight, width, height, railBottom, subject }) {
    if (![sourceWidth, sourceHeight, width, height].every(n => Number.isFinite(n) && n > 0)) return null;
    const raw = subject?.bounds;
    if (!raw || ![raw.left,raw.right,raw.top,raw.bottom].every(Number.isFinite)) return null;
    const bounds = Object.fromEntries(Object.entries(raw).map(([k,v]) => [k,clamp(v,0,1)]));
    const cover = Math.max(width / sourceWidth, height / sourceHeight);
    const top = railBottom + 8, feather = height * .84;
    const faceWidth = Math.max(.01,bounds.right-bounds.left) * sourceWidth;
    const faceHeight = Math.max(.01,bounds.bottom-bounds.top) * sourceHeight;
    // The photo box has a fixed height. Zoom only to lift a face from under the
    // metadata rail, never beyond what keeps the face above the feather.
    const maxFaceScale = Math.max(cover, Math.min(width / faceWidth, (feather - top) / faceHeight));
    const topScale = bounds.top > .01 ? top / (bounds.top * sourceHeight) : cover;
    const scale = clamp(Math.max(cover,topScale),cover,maxFaceScale);
    const imageW = sourceWidth * scale, imageH = sourceHeight * scale;
    const lowX = Math.max(width-imageW, -bounds.left*imageW);
    const highX = Math.min(0, width-bounds.right*imageW);
    const desiredX = width/2 - subject.x*imageW;
    const x = lowX<=highX ? clamp(desiredX,lowX,highX) : clamp(desiredX,width-imageW,0);
    // y keeps the face between the rail and the feather, as close to the photo's
    // top as possible; a face taller than that window is centered in it.
    const minY = top - bounds.top*imageH, maxY = feather - bounds.bottom*imageH;
    const wanted = minY <= maxY ? clamp(0, minY, maxY) : (minY + maxY) / 2;
    const y = clamp(wanted, height-imageH, 0);
    return { width:imageW, height:imageH, x, y, boxHeight: height };
}

export function frameMobilePhoto(card) {
    const img = card.querySelector('img.thumbnail-img'), hero = card.querySelector('.article-card-image');
    if (!img || !hero) return;
    const subject = subjects.get(img), hr = hero.getBoundingClientRect();
    const boxHeight = mobilePhotoHeight(card.ownerDocument.defaultView?.innerWidth);
    const railBottom = Math.max(0,...[...card.querySelectorAll('.article-metadata, .story-rank, .story-coverage-orbs')]
        .filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().bottom-hr.top));
    const p = placeMobilePhoto({ sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight, width: hr.width, height: boxHeight, railBottom, subject });
    if (!p || !img.naturalWidth || !hr.width) {
        delete card.dataset.mobileFramed;
        card.style.removeProperty('--mobile-photo-boxHeight');
        return;
    }
    for (const [key,value] of Object.entries(p)) {
        const name = `--mobile-photo-${key}`, text = `${value.toFixed(3)}px`;
        if (card.style.getPropertyValue(name)!==text) card.style.setProperty(name,text);
    }
    card.dataset.mobileFramed = '1';
}

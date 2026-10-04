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
export function placeMobilePhoto({ sourceWidth, sourceHeight, width, height, railBottom, subject }) {
    if (![sourceWidth, sourceHeight, width, height].every(n => Number.isFinite(n) && n > 0)) return null;
    const raw = subject?.bounds;
    if (!raw || ![raw.left,raw.right,raw.top,raw.bottom].every(Number.isFinite)) return null;
    const bounds = Object.fromEntries(Object.entries(raw).map(([k,v]) => [k,clamp(v,0,1)]));
    const cover = Math.max(width / sourceWidth, height / sourceHeight);
    const top = railBottom + 8;
    const faceWidth = Math.max(.01,bounds.right-bounds.left) * sourceWidth;
    // Coverage is a hard constraint. Zoom may increase to put the face below
    // the fixed rail; it may never shrink the photo below the container width.
    const maxFaceScale = Math.max(cover, width / faceWidth);
    const topScale = bounds.top > .01 ? top / (bounds.top * sourceHeight) : cover;
    const scale = clamp(Math.max(cover,topScale),cover,maxFaceScale);
    const imageW = sourceWidth * scale, imageH = sourceHeight * scale;
    const lowX = Math.max(width-imageW, -bounds.left*imageW);
    const highX = Math.min(0, width-bounds.right*imageW);
    const desiredX = width/2 - subject.x*imageW;
    const x = lowX<=highX ? clamp(desiredX,lowX,highX) : clamp(desiredX,width-imageW,0);
    const y = clamp(top-bounds.top*imageH, height-imageH, 0);
    // If the zoomed face needs more vertical room, extend the photo area rather
    // than introducing a top/side inset or placing the title over the face.
    const boxHeight = Math.min(imageH+y, Math.max(height,(y+bounds.bottom*imageH+8)/.84));
    return { width:imageW, height:imageH, x, y:clamp(y,boxHeight-imageH,0), boxHeight };
}

export function frameMobilePhoto(card) {
    const img = card.querySelector('img.thumbnail-img'), hero = card.querySelector('.article-card-image');
    if (!img || !hero) return;
    const subject = subjects.get(img), hr = hero.getBoundingClientRect();
    const railBottom = Math.max(0,...[...card.querySelectorAll('.article-metadata, .story-rank, .story-coverage-orbs')]
        .filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().bottom-hr.top));
    const p = placeMobilePhoto({ sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight, width: hr.width, height: hr.width * 9 / 16, railBottom, subject });
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

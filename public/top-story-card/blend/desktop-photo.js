// Desktop placement is a translation of a fixed-size, intrinsic photograph.
// Its intentional right overflow belongs to the card's rounded clipping edge.
export const DESKTOP_PHOTO_LEFT = .48;
export const DESKTOP_PHOTO_WIDTH = .66;

export function intrinsicPhotoAnalysis(analysis, img) {
    if (analysis.crop?.some(value => value > 0) || !img.naturalWidth || !img.naturalHeight) return analysis;
    return { ...analysis, w: img.naturalWidth, h: img.naturalHeight };
}

export function placeDesktopPhoto(a, { width, height, left = DESKTOP_PHOTO_LEFT } = {}) {
    const f = a.focal || { x: .5, y: .4, w: .18, h: .18 };
    const imageW = width * DESKTOP_PHOTO_WIDTH;
    const imageH = imageW * a.h / a.w;
    const offsetX = width * left;
    const subject = {
        left: (offsetX + (f.x - f.w / 2) * imageW) / width,
        right: (offsetX + (f.x + f.w / 2) * imageW) / width,
        top: (f.y - f.h / 2) * imageH / height,
        bottom: (f.y + f.h / 2) * imageH / height
    };
    return {
        mode: a.graphic ? 'G' : 'B', placement: 'editorial',
        heroW: width, heroH: imageH, imageW, imageH, offsetX, offsetY: 0,
        scale: 1, fitScale: imageW / a.w, posX: f.x * 100, posY: f.y * 100,
        maskH: 'none', maskV: 'none', span: .22, clearStart: left + .14,
        meltStart: imageH * .90 / height, subject,
        target: { x: left + f.x * DESKTOP_PHOTO_WIDTH, y: f.y * imageH / height },
        safetyFit: false
    };
}

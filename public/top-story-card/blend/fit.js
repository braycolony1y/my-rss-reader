import { clamp } from './palette.js';
import { smoothMask } from './masks.js';
import { placeDesktopPhoto } from './desktop-photo.js?v=20261003_organic_1';

// Fit the complete source with one uniform scale. Never cover-crop it or
// apply a second focal zoom; small sources are enlarged only to the fit box.
export function fitStoryHero(a, { width, height, panelTop = .64, headingRight = .54,
    avatar = { left: .75, top: .03, right: .99, bottom: .12 }, stacked = width < 640 } = {}) {
    if (!stacked && !a.hasTransparency) return placeDesktopPhoto(a, { width, height });
    const f = a.focal || { x:.5, y:.4, w:.18, h:.18, kind:'default' };
    const focal = { left:clamp(f.x-f.w/2,0,1), right:clamp(f.x+f.w/2,0,1),
        top:clamp(f.y-f.h/2,0,1), bottom:clamp(f.y+f.h/2,0,1) };
    const clearStart = stacked ? 0 : clamp(headingRight + .06, .55, .64);
    const targetX = f.w > .22 ? .70 : .74;
    const boxW = stacked ? width : width * (a.hasTransparency ? .42 : .60);
    const boxH = stacked ? width * 9 / 16 : Math.max(height * .35, panelTop * height + 20);
    const protectFace = f.kind === 'face';
    const targetW = stacked || !protectFace ? boxW : width * (1 - targetX) / Math.max(.1, 1 - f.x);
    const clearW = stacked || !protectFace ? boxW : width * (1 - clearStart) / Math.max(.1, 1 - focal.left);
    let fitScale = Math.min(boxW / a.w, boxH / a.h, targetW / a.w, clearW / a.w);
    let imageW = a.w * fitScale, imageH = a.h * fitScale;
    const heroW = stacked ? width : a.hasTransparency ? width*.60 : imageW;
    let offsetX = stacked ? (width - imageW) / 2 : heroW-imageW;
    let offsetY = 0;
    const mapSubject = () => ({ left:(width-heroW+offsetX+focal.left*imageW)/width,
        right:(width-heroW+offsetX+focal.right*imageW)/width,
        top:(offsetY+focal.top*imageH)/height, bottom:(offsetY+focal.bottom*imageH)/height });
    let subject = mapSubject();
    const overlapsAvatar = () => subject.left < avatar.right && subject.right > avatar.left
        && subject.top < avatar.bottom && subject.bottom > avatar.top;
    if (overlapsAvatar()) {
        if (stacked && imageW < width) offsetX = clamp(avatar.left*width-focal.right*imageW-10,0,width-imageW);
        subject = mapSubject();
        if (overlapsAvatar()) {
            const safeTop = avatar.bottom*height+10;
            if (stacked) {
                fitScale = Math.min(fitScale,Math.max(1,boxH-safeTop)/(a.h*(1-focal.top)));
                imageW = a.w*fitScale; imageH = a.h*fitScale; offsetX = (width-imageW)/2;
            }
            offsetY = Math.max(0,safeTop-focal.top*imageH);
        }
        subject = mapSubject();
    }
    const heroH = stacked ? boxH : imageH + offsetY;
    const left = width - heroW;
    const span = stacked ? 0 : clamp((clearStart*width-left)/heroW, .06, .38);
    const melt = clamp(Math.max(.72, focal.bottom+.06), .72, .92);
    const meltStart = (offsetY + melt*imageH) / height;
    let maskH = stacked ? 'linear-gradient(#000, #000)' : smoothMask('right',0,span);
    if (stacked && imageW < width-.1) {
        maskH = `${smoothMask('right',offsetX/width,(offsetX+imageW*.08)/width)}, ${smoothMask('right',(offsetX+imageW*.92)/width,(offsetX+imageW)/width,true)}`;
    }
    const bottomMask = smoothMask('bottom',(offsetY+melt*imageH)/heroH,(offsetY+imageH)/heroH,true);
    const maskV = offsetY > 0 ? `${smoothMask('bottom',offsetY/heroH,(offsetY+imageH*.05)/heroH)}, ${bottomMask}` : bottomMask;
    return { mode:a.graphic?'G':'B', placement:stacked?'stacked':a.hasTransparency?'contain':'fit',
        heroW,heroH,imageW,imageH,offsetX,offsetY,scale:1,fitScale,posX:50,posY:0,maskH,maskV,
        meltStart,span,clearStart,target:{x:targetX,y:(offsetY+f.y*imageH)/height},subject,
        safetyFit:!stacked && imageW < boxW-.1 };
}

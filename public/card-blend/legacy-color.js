// Palette compatibility stays isolated from the new normalized ambient assets.
import {extractLiquidTint,tintProperties} from '../liquid-tint.js';
import {selectImagePalette} from '../image-palette.js';
import {applyCardBlend} from './runtime.js';
export function applyImageColors(img,state,{doc,ready,isDefault,backdropColor}) {
    const card=img.closest('.article-card');
    if(ready&&!isDefault&&!state.palette&&!state.paletteSampled&&/^(\/public\/|data:|blob:)/.test(state.source||'')) {
        state.paletteSampled=true;
        try {
            const canvas=doc.createElement('canvas');canvas.width=canvas.height=64;
            const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0,64,64);
            const pixels=context.getImageData(0,0,64,64).data;
            state.tint=extractLiquidTint(pixels);state.palette=selectImagePalette(pixels,64,64,4);
        } catch { /* Offline/local fallback retains neutral tokens. */ }
    }
    for(const [key,value] of Object.entries(card?.closest('.theme-glass-light') ? {} : tintProperties(isDefault?null:state.tint))) {
        if(card&&card.style.getPropertyValue(key)!==value)card.style.setProperty(key,value);
    }
    for(const name of ['primary','secondary']) {
        const color=isDefault?null:state.palette?.[name];
        const value=Array.isArray(color)&&color.length===3&&color.every(n=>Number.isFinite(n)&&n>=0&&n<=255)?backdropColor(color).join(' '):'';
        const key=`--thumbnail-${name}`;
        if(card&&card.style.getPropertyValue(key)!==value) {if(value)card.style.setProperty(key,value);else card.style.removeProperty(key);}
    }
    applyCardBlend(card,isDefault?null:state.blend,{near:state.near});
}

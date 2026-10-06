import {rgbToOklab,hueOf,gamutMap,clamp} from '../../../public/card-blend/color.js';
// The brief's raw blurred-photo recipe conflicts with its darker/grayer ban.
// Lift the stored melt, not the live DOM, to its local ambient floor.
export function normalizeMelt(data,width,height,cells) {
    const out=Buffer.alloc(width*height*3);
    const lab = [0, 0, 0], mapped = { rgb: [0, 0, 0] };
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        const i=(y*width+x)*3;
        const [L,a,b]=rgbToOklab(data[i],data[i+1],data[i+2],lab);
        const ambient=cells[Math.min(15,Math.floor(y*16/height))*24+Math.min(23,Math.floor(x*24/width))];
        const h=(ambient.h+clamp((hueOf(a,b)-ambient.h+540)%360-180,-15,15)+360)%360;
        gamutMap(clamp(Math.max(L,ambient.L),ambient.L,.955),Math.max(ambient.C,Math.min(.085,Math.hypot(a,b))),h,mapped);
        out.set(mapped.C+1e-6<ambient.C?ambient.rgb:mapped.rgb,i);
    }
    return out;
}

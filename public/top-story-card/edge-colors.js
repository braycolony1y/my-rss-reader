import { rgbToOklab, gamutMap } from './blend/palette.js';
const cache = new WeakMap();
const set = (el,key,value) => { if(el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value); };
// Sample only the strip actually visible at the bottom of the cover crop.
// This consumes the selected object-position; it never changes image focus.
export function applyBottomEdgeColor(card) {
    if(card.dataset.smartHeroExtent !== 'analysis') { delete card.dataset.edgeColor; return; }
    const soft=card.querySelector('.thumbnail-soft');
    const img=card.dataset.storyPhoto==='cropped' && soft?.complete && soft.naturalWidth ? soft : card.querySelector('.thumbnail-img');
    const panel=card.querySelector('.story-analysis-shell');
    if(!img?.complete || !img.naturalWidth || !panel)return;
    const box=img.getBoundingClientRect(), cr=card.getBoundingClientRect();
    if(!box.width || !box.height)return;
    const position=card.ownerDocument.defaultView.getComputedStyle(img).objectPosition.split(' ').map(parseFloat);
    const scale=Math.max(box.width/img.naturalWidth,box.height/img.naturalHeight);
    const offsetX=(box.width-img.naturalWidth*scale)*(position[0]/100);
    const offsetY=(box.height-img.naturalHeight*scale)*(position[1]/100);
    const sx=Math.max(0,(Math.max(box.left,cr.left+cr.width*.64)-box.left-offsetX)/scale);
    const right=Math.min(img.naturalWidth,(Math.min(box.right,cr.right)-box.left-offsetX)/scale);
    const sy=Math.max(0,(box.height-8-offsetY)/scale);
    const sh=Math.max(1,Math.min(img.naturalHeight-sy,8/scale));
    const key=[img.currentSrc,box.width,box.height,position.join(','),sx,right,sy].join('|');
    let color=cache.get(img);
    if(color?.key!==key){
        try {
            const canvas=card.ownerDocument.createElement('canvas');canvas.width=32;canvas.height=4;
            const ctx=canvas.getContext('2d',{willReadFrequently:true});
            ctx.drawImage(img,sx,sy,Math.max(1,right-sx),sh,0,0,32,4);
            const data=ctx.getImageData(0,0,32,4).data;
            const rgb=[0,0,0];let n=0;
            for(let i=0;i<data.length;i+=4)if(data[i+3]>128){for(let c=0;c<3;c++)rgb[c]+=data[i+c];n++;}
            if(!n)return;
            const [L,a,b]=rgbToOklab(...rgb.map(v=>v/n));
            const H=(Math.atan2(b,a)*180/Math.PI+360)%360,C=Math.min(.065,Math.hypot(a,b));
            const tint=gamutMap(Math.min(.96,L*.55+.4),C,H);
            color={key,value:`oklch(${tint.L.toFixed(4)} ${tint.C.toFixed(5)} ${H.toFixed(2)})`};cache.set(img,color);
        } catch { return; } // Cross-origin/undecoded sources retain the existing palette.
    }
    set(card,'--edge-bottom-color',color.value);
    set(card,'--edge-color-start',`${(panel.getBoundingClientRect().top-cr.top).toFixed(3)}px`);
    card.dataset.edgeColor='ready';
}

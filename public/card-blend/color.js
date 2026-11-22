import { rgbToOklab } from '../liquid-tint.js';
export { rgbToOklab };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const hueOf = (a, b) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
export const hueDistance = (a, b) => Math.abs((a - b + 540) % 360 - 180);
import { gamutMap } from './color-conversion.js';
export { labToLinear, gamutMap } from './color-conversion.js';
// Exact area weights are applied AFTER converting source pixels to OKLab.
export function areaLabGrid(data, width, height, channels = 3, columns = 24, rows = 16) {
    const grid = Array.from({length: columns*rows}, () => [0,0,0,0]);
    const lab = [0, 0, 0];
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const i=(y*width+x)*channels, alpha=channels===4?data[i+3]/255:1;
        if (!alpha) continue;
        rgbToOklab(data[i],data[i+1],data[i+2],lab);
        const x0=x*columns/width,x1=(x+1)*columns/width,y0=y*rows/height,y1=(y+1)*rows/height;
        for(let gy=Math.floor(y0);gy<Math.min(rows,Math.ceil(y1));gy++) for(let gx=Math.floor(x0);gx<Math.min(columns,Math.ceil(x1));gx++) {
            const w=(Math.min(x1,gx+1)-Math.max(x0,gx))*(Math.min(y1,gy+1)-Math.max(y0,gy))*alpha;
            const cell=grid[gy*columns+gx]; for(let c=0;c<3;c++)cell[c]+=lab[c]*w; cell[3]+=w;
        }
    }
    return grid.map(cell => cell[3] ? cell.slice(0,3).map(v=>v/cell[3]) : [.93,0,0]);
}
export function normalizeAmbient(grid, columns = 24) {
    const seam=grid.filter((_,i)=>(i%columns+.5)/columns<.4);
    const eligible=c=>c[0]>.15&&c[0]<.97&&Math.hypot(c[1],c[2])>.015;
    let reference=seam.filter(eligible); if(!reference.length)reference=grid.filter(eligible);
    const sum=reference.reduce((s,c)=>{const w=c[1]**2+c[2]**2;return[s[0]+c[1]*w,s[1]+c[2]*w]},[0,0]);
    const h_ref=reference.length?hueOf(...sum):250;
    const meanL=grid.reduce((s,c)=>s+c[0],0)/grid.length;
    const cells=grid.map(([L,a,b])=>{
        const C=Math.hypot(a,b), h0=C>=.02?hueOf(a,b):h_ref;
        const h=(h_ref+clamp((h0-h_ref+540)%360-180,-45,45)+360)%360;
        // The numeric QA floor (.05) takes precedence over the prose .035.
        const targetC=clamp(C*1.3+.012,.05,h>=85&&h<=135?.06:.085);
        let light=clamp(.93+(L-meanL)*.10,.90,.955);
        // Preserve the QA chroma floor where possible before reducing chroma
        // to fit sRGB. All adjustments are shared, never per-card tuning.
        while(light>.9001 && gamutMap(light,targetC,h).C<.05) light=Math.max(.90,light-.001);
        return gamutMap(light,targetC,h);
    });
    const seamCells=cells.filter((_,i)=>(i%columns+.5)/columns<.4);
    const edgeL=seam.reduce((s,c)=>s+c[0],0)/seam.length;
    return { cells, h_ref, c_ref:seamCells.reduce((s,c)=>s+c.C,0)/seamCells.length, edgeL, k:clamp((.90-edgeL)/.5,0,1) };
}
export function blendTokens(value) {
    const {h_ref:h=250,c_ref:c=.06,k=0}=value || {};
    return {'--tb':`oklch(.962 ${clamp(c*.5,.03,.05)} ${h})`,
        '--td':`oklch(.80 ${clamp(c*.9,.04,.09)} ${h})`, '--accent':`oklch(.48 .11 ${h})`,
        '--ink':`oklch(.22 .02 ${h})`, '--ink-2':`oklch(.42 .02 ${h})`,
        '--tint-hue':`${h}`, '--blend-k':`${k}`};
}

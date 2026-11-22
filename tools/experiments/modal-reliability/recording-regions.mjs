import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

async function isReviewedSource(video) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(video)) hash.update(chunk);
    return hash.digest('hex') === '754b9f57c7c5580e26e1a5bdd9d6c652b3ac785ca6205ac37ed78e4944bb9f7b';
}

export async function selectRegions({ video, metadata, configPath }) {
    let config;
    for (const path of configPath ? [configPath] : [`${video}.regions.json`, video.replace(/\.[^.]+$/, '.regions.json')]) {
        try { config = JSON.parse(await readFile(path, 'utf8')); config.selectedFrom = path; break; }
        catch (error) { if (error.code !== 'ENOENT' || configPath) throw error; }
    }
    // Only the previously reviewed source recording has an automatic profile.
    // Other viewports/modals require their own measured, reviewable regions.
    if (!config && metadata.stream.width === 2906 && metadata.stream.height === 1720
        && metadata.frames.length === 772 && Math.abs(Number(metadata.stream.duration) - 13.878333) < .01
        && await isReviewedSource(video)) {
        config = { profile: 'reviewed-original-ai-usage', width: 2906, height: 1720, visibleFrame: 0,
            regions: [
                { name: 'dialog-header', role: 'foreground', left: 450, top: 100, width: 1950, height: 130 },
                { name: 'dialog-footer', role: 'foreground', left: 450, top: 1500, width: 1950, height: 100 },
                { name: 'left-backdrop', role: 'backdrop', left: 20, top: 300, width: 150, height: 500 }
            ] };
    }
    if (!config) return null;
    if (config.width !== metadata.stream.width || config.height !== metadata.stream.height)
        throw Error('Region calibration dimensions differ from this recording; recalibrate for this viewport');
    if (!Array.isArray(config.regions) || config.regions.length < 3
        || config.regions.filter(r => r.role === 'foreground').length < 2
        || !config.regions.some(r => r.role === 'backdrop'))
        throw Error('Choose at least two stable foreground regions and one backdrop region');
    for (const r of config.regions) {
        if (!r.name || !['foreground', 'backdrop'].includes(r.role)
            || !['left', 'top', 'width', 'height'].every(k => Number.isInteger(r[k]))
            || r.left < 0 || r.top < 0 || r.width < 2 || r.height < 2
            || r.left + r.width > config.width || r.top + r.height > config.height)
            throw Error(`Invalid region: ${r.name || '(unnamed)'}`);
        if (r.threshold !== undefined && (!Number.isFinite(r.threshold) || r.threshold <= 0 || r.threshold > 255))
            throw Error(`Invalid difference threshold: ${r.name}`);
    }
    if (config.maxTransientSeconds !== undefined && (!Number.isFinite(config.maxTransientSeconds) || config.maxTransientSeconds <= 0))
        throw Error('Invalid transient duration limit');
    config.visibleFrame ??= 0;
    if (!Number.isInteger(config.visibleFrame) || !metadata.frames[config.visibleFrame]) throw Error('Invalid visible reference frame');
    return config;
}

export function regionPicker(imageBase64, metadata) {
    return `<!doctype html><meta charset="utf-8"><title>Recording region calibration</title>
<style>body{font:16px system-ui;max-width:1200px;margin:24px auto;padding:16px}canvas{width:100%;border:1px solid #888;touch-action:none}button,select,input{font:inherit;margin:6px;padding:8px}pre{white-space:pre-wrap}</style>
<h1>Choose stable recording regions</h1><p>Use a recording that begins with the modal fully open. Drag two boxes over fixed foreground details and one over the backdrop. Avoid scrolling text, changing statistics, cursor position, and recording controls. For the article reader, choose its header and a narrow solid panel edge; its body scrolls.</p>
<label>Region role <select id="role"><option value="foreground">Foreground</option><option value="backdrop">Backdrop</option></select></label><button id="undo">Undo</button><button id="save">Download regions.json</button>
<canvas id="canvas" width="${metadata.stream.width}" height="${metadata.stream.height}"></canvas><pre id="status"></pre>
<script>
const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d'),img=new Image(),regions=[];let start=null;
img.src='data:image/png;base64,${imageBase64}';img.onload=draw;
function point(e){const r=canvas.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*canvas.width/r.width),y:Math.round((e.clientY-r.top)*canvas.height/r.height)}}
function draw(){ctx.drawImage(img,0,0);ctx.lineWidth=4;for(const r of regions){ctx.strokeStyle=r.role==='backdrop'?'#d946ef':'#16a34a';ctx.strokeRect(r.left,r.top,r.width,r.height)}document.getElementById('status').textContent=JSON.stringify(regions,null,2)}
canvas.onpointerdown=e=>{start=point(e);canvas.setPointerCapture(e.pointerId)};
canvas.onpointerup=e=>{if(!start)return;const end=point(e),role=document.getElementById('role').value;regions.push({name:role+'-'+(regions.length+1),role,left:Math.max(0,Math.min(start.x,end.x)),top:Math.max(0,Math.min(start.y,end.y)),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});start=null;draw()};
document.getElementById('undo').onclick=()=>{regions.pop();draw()};
document.getElementById('save').onclick=()=>{if(regions.filter(r=>r.role==='foreground').length<2||!regions.some(r=>r.role==='backdrop'))return alert('Choose at least two foreground regions and one backdrop.');const config={profile:'manually-calibrated',width:canvas.width,height:canvas.height,visibleFrame:0,regions};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));a.download='regions.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
</script>`;
}

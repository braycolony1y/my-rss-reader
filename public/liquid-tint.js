// Shared server/browser extraction from a downscaled 64×64 sRGB image.
export const NEUTRAL_TINT = Object.freeze({ h1: 250, h2: 250, h3: 250, cs: .03, cs1: .03, cs2: .03, cs3: .03, edgeL: .8, contrast: 0 });
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const hue = (a, b) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
const hueDelta = (a, b) => (a - b + 540) % 360 - 180;
import { rgbToOklab } from './card-blend/color-conversion.js';
export { rgbToOklab };
export const MASK_STOPS = [[0,0],[.1,.01],[.2,.05],[.3,.13],[.4,.26],[.5,.44],[.6,.63],[.7,.80],[.8,.92],[.9,.98],[1,1]];
export function maskVisibility(x) {
    for (let i = 1; i < MASK_STOPS.length; i++) {
        const [end,b] = MASK_STOPS[i], [start,a] = MASK_STOPS[i-1];
        if (x <= end) return a + (b-a) * clamp((x-start)/(end-start), 0, 1);
    }
    return 1;
}
const tintChroma = (cs, h) => clamp(cs * .9, .04, h >= 85 && h <= 135 ? .05 : .075);
function summarize(pixels) {
    let a = 0, b = 0;
    for (const p of pixels) { const w = p.c * p.c; a += p.lab[1] * w; b += p.lab[2] * w; }
    const chromas = pixels.map(p => p.c).sort((a,b) => a-b);
    return { h: hue(a,b), cs: chromas[Math.max(0, Math.ceil(chromas.length * .9)-1)] || 0 };
}
export function extractLiquidTint(data, width = 64, height = 64, channels = 4) {
    const bands = [[],[],[]], edge = []; let edgeSum = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        if (channels === 4 && data[i+3] < 128) continue;
        const position = (x+.5)/width;
        if (position < .1 || position >= .45) continue;
        const lab = rgbToOklab(data[i], data[i+1], data[i+2]);
        const band = Math.min(2, Math.floor(y * 3 / height));
        const pixel = { lab, c: Math.hypot(lab[1], lab[2]), band };
        edge.push(pixel); edgeSum += lab[0];
        if (lab[0] >= .20 && lab[0] <= .97) bands[band].push(pixel);
    }
    // Tiny samples (used by fallback callers) still describe their one color.
    if (!edge.length && width * height === 1) {
        const lab = rgbToOklab(data[0], data[1], data[2]);
        const p = { lab, c: Math.hypot(lab[1], lab[2]), band: 1 };
        if (channels !== 4 || data[3] >= 128) { edge.push(p); edgeSum = lab[0]; if (lab[0] >= .2 && lab[0] <= .97) bands[1].push(p); }
    }
    const summaries = bands.map(summarize);
    const colored = summaries.map((p,i) => p.cs >= .02 ? i : -1).filter(i => i >= 0);
    const inherited = summaries.map((p,i) => {
        if (p.cs >= .02) return {...p};
        if (!colored.length) return { h: 250, cs: .03 };
        const nearest = colored.reduce((a,b) => Math.abs(b-i) < Math.abs(a-i) ? b : a);
        return {...summaries[nearest]};
    });
    for (let i = 1; i < 3; i++) inherited[i].h = (inherited[i-1].h + clamp(hueDelta(inherited[i].h, inherited[i-1].h), -20, 20) + 360) % 360;
    const contrast = edge.length ? edge.reduce((sum,p) => {
        const t = inherited[p.band], c = tintChroma(t.cs,t.h), rad = t.h * Math.PI / 180;
        return sum + Math.hypot(p.lab[0]-.93, p.lab[1]-c*Math.cos(rad), p.lab[2]-c*Math.sin(rad));
    },0) / edge.length : 0;
    return { h1: inherited[0].h, h2: inherited[1].h, h3: inherited[2].h,
        cs1: inherited[0].cs, cs2: inherited[1].cs, cs3: inherited[2].cs,
        cs: inherited[1].cs, edgeL: edge.length ? edgeSum / edge.length : .8, contrast };
}
export function tintProperties(value) {
    const t = value && ['h1','cs','edgeL'].every(k => Number.isFinite(value[k])) ? value : NEUTRAL_TINT;
    const hs = [t.h1, Number.isFinite(t.h2) ? t.h2 : t.h1, Number.isFinite(t.h3) ? t.h3 : t.h1].map(h => (h%360+360)%360);
    const cs = [t.cs1,t.cs2,t.cs3].map((c,i) => tintChroma(Number.isFinite(c) ? c : t.cs, hs[i]));
    const delta = Number.isFinite(t.secondaryHue) && !Number.isFinite(t.h2) ? clamp(hueDelta(t.secondaryHue, hs[1]), -12, 12) : 0;
    const readingHue = (hs[1]+delta+360)%360;
    return {
        '--tint-hue': `${hs[1]}`,
        ...Object.fromEntries(hs.map((h,i) => [`--ta-${i+1}`, `oklch(0.93 ${cs[i]} ${h})`])),
        '--tint-a': `oklch(0.93 ${cs[1]} ${hs[1]})`,
        '--tint-b': `oklch(0.962 ${clamp(cs.reduce((a,b) => a+b,0)/6,.025,.04)} ${readingHue})`,
        '--tint-deep': `oklch(0.80 ${clamp(cs[1]*.9,.04,.09)} ${hs[1]})`,
        '--accent': `oklch(0.48 0.11 ${hs[1]})`,
        '--liquid-image-width': t.contrast > .12 ? '58%' : '48%',
        '--tint-lift': t.edgeL < .35 ? '0.70' : t.edgeL <= .65 ? '0.45' : '0.30'
    };
}

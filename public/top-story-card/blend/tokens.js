import { clamp, gamutMap, hueDistance } from './palette.js';
export const BRAND_HUE = 250;
const color = (L, C, H) => {
    const c = gamutMap(L, C, H);
    return `oklch(${L.toFixed(4)} ${c.C.toFixed(5)} ${H.toFixed(2)})`;
};
export function deriveStoryTokens(analysis, { forceLight = true } = {}) {
    const a = analysis || { avgL: .7, meanChroma: 0, hueCoherence: 1, hMean: BRAND_HUE, clusters: [], bottomBand: { L: .8, C: 0, H: BRAND_HUE } };
    const monochrome = a.meanChroma < .012;
    const h = monochrome ? 60 : a.hMean;
    const colored = a.clusters.filter(c => c.C >= .04);
    const dominant = colored[0];
    let accent = colored.filter(c => c.pop >= .03).sort((a, b) => b.pop * b.C - a.pop * a.C)[0];
    if (accent?.pop < .08 && dominant && hueDistance(accent.H, h) > 40) accent = dominant;
    const accentH = monochrome ? BRAND_HUE : accent?.H ?? BRAND_HUE;
    const accentC = monochrome ? .09 : Math.min(.09, accent?.C ?? .09);
    const tier = a.hueCoherence >= .85 ? 'high' : a.hueCoherence >= .55 ? 'mid' : 'low';
    const scrimH = tier === 'low' ? [...a.clusters].filter(c => c.pop >= .08).sort((a, b) => b.L - a.L)[0]?.H ?? h : h;
    const scrimC = monochrome ? .008 : tier === 'low' ? .01 : Math.min(.3 * (dominant?.C ?? .03), tier === 'high' ? .05 : .025);
    const dark = !forceLight && a.avgL < .38;
    const bottomL = clamp(a.bottomBand.L * .3 + .96 * .7, .80, .96);
    const bottomH = a.bottomBand.C >= .012 ? a.bottomBand.H : scrimH;
    return { style: dark ? 'dark' : 'light', tier, accentH, accentC, scrimH, scrimC,
        saturation: monochrome ? 1 : clamp(.06 / a.meanChroma, 1.1, 1.8),
        luminanceGap: Math.abs(a.bottomBand.L - .96) > .35,
        css: {
            '--scrim-left': color(dark ? .20 : .95, dark ? Math.min(scrimC * .5, .05) : scrimC, scrimH),
            '--scrim-bottom': color(dark ? .20 : bottomL, dark ? Math.min(scrimC * .5, .05) : scrimC * .8, bottomH),
            '--ink': color(dark ? .97 : .30, dark ? .01 : .03, h),
            '--ink-muted': color(dark ? .82 : .42, .025, h),
            '--ink-faint': color(dark ? .68 : .52, .02, h),
            '--accent-text': color(dark ? .82 : .42, dark ? .10 : accentC, accentH),
            '--panel-tint': color(dark ? .24 : .975, dark ? .02 : Math.min(.012, .3 * (dominant?.C ?? .03)), h),
            '--sat': String(monochrome ? 1 : clamp(.06 / a.meanChroma, 1.1, 1.8))
        }
    };
}

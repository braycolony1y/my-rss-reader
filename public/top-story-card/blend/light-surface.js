import { gamutMap } from './palette.js';

// Shared material treatment. Callers choose the image region, not the styling.
export const LIGHT_SURFACE = Object.freeze({
    primaryLightness: .965,
    secondaryLightness: .9,
    primaryPercent: 82,
    chromaScale: .48,
    maxChroma: .035,
});
export function lightAtmosphere(sample, lightness) {
    const chroma = Math.min(LIGHT_SURFACE.maxChroma, (sample?.C || 0) * LIGHT_SURFACE.chromaScale);
    const hue = sample?.H ?? 250;
    const mapped = gamutMap(lightness, chroma, hue);
    return `oklch(${lightness.toFixed(4)} ${mapped.C.toFixed(5)} ${hue.toFixed(2)})`;
}
export function neutralLightSurface(primary, secondary = primary) {
    return `color-mix(in oklab, ${lightAtmosphere(primary, LIGHT_SURFACE.primaryLightness)} ${LIGHT_SURFACE.primaryPercent}%, ${lightAtmosphere(secondary, LIGHT_SURFACE.secondaryLightness)})`;
}

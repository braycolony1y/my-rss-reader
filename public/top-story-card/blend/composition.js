import { clamp, gamutMap } from './palette.js';
import { desktopPhotoEnvelope, desktopMaskProperties } from './organic-envelope.js?v=20261003_dual_mask_1';

const cssColor = (L, C, H) => {
    const mapped = gamutMap(L, C, H);
    return `oklch(${L.toFixed(4)} ${mapped.C.toFixed(5)} ${H.toFixed(2)})`;
};

// Mobile keeps its existing contour. Desktop combines independently controlled
// left and lower masks in source-photo coordinates without changing geometry.
export function organicPhotoMask({ stacked = false, soft = false, subjectBottom = .6 } = {}) {
    if (!stacked) return desktopPhotoEnvelope({ soft, subjectBottom });
    const bottom = clamp(Math.max(.82, subjectBottom + .16), .82, .98) * 1000;
    const feather = soft ? 170 : 85;
    const path = stacked
        ? `M -300 40 C 250 -85, 820 60, 1300 -70 V ${bottom} C 810 ${bottom + 150}, 530 ${bottom - 95}, -300 ${bottom + 45} Z`
        : `M ${soft ? -160 : 30} -300 H 1300 V ${bottom - 100}
           C 1000 ${bottom + 45}, 760 ${bottom - 180}, 140 ${bottom - 25}
           C 210 665, 225 440, 115 235 C 45 115, 20 15, ${soft ? -160 : 30} -300 Z`;
    // Keep the Gaussian's tail from ending at the rectangular source bounds.
    // The contour still controls the transition; this envelope makes its last
    // pixels reach zero, including the upper edge of a stacked mobile photo.
    const edge = `${stacked ? '<stop offset="0" stop-color="white" stop-opacity="0"/><stop offset=".14" stop-color="white"/>' : '<stop offset="0" stop-color="white"/>'}<stop offset="${soft ? '.70' : '.66'}" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${feather}"/></filter><linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">${edge}</linearGradient><mask id="envelope" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><rect width="1000" height="1000" fill="url(#edge)"/></mask></defs><g mask="url(#envelope)"><path fill="white" filter="url(#f)" d="${path}"/></g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function deriveStoryComposition(analysis, geometry) {
    const { p, width } = geometry;
    const stacked = p.placement === 'stacked';
    const clusters = analysis.clusters || [];
    const region = (x, y) => clusters.reduce((best, c) => {
        const distance = (c.x - x) ** 2 + (c.y - y) ** 2 + .03 / Math.max(.01, c.pop);
        return !best || distance < best.distance ? { ...c, distance } : best;
    }, null);
    const atmosphere = (x, y, L) => {
        const c = region(x, y);
        return cssColor(L, Math.min(.035, (c?.C || 0) * .48), c?.H ?? 250);
    };
    const subjectBottom = (analysis.focal?.y ?? .4) + (analysis.focal?.h ?? .2) / 2;
    return {
        '--hero-photo-left': `${(p.offsetX / width * 100).toFixed(2)}%`,
        '--hero-photo-width': `${(p.imageW / width * 100).toFixed(2)}%`,
        '--hero-photo-ratio': `${p.imageW} / ${p.imageH}`,
        '--hero-soft-left': `${(p.offsetX / width * 100 - 2).toFixed(2)}%`,
        '--hero-soft-width': `${(p.imageW / width * 100 + 2).toFixed(2)}%`,
        ...(!stacked ? desktopMaskProperties() : {}),
        '--detail-mask': organicPhotoMask({ stacked, subjectBottom }),
        '--color-mask': organicPhotoMask({ stacked, soft: true, subjectBottom }),
        '--field-land': atmosphere(.15, .2, .96),
        '--field-center': atmosphere(.45, .5, .94),
        '--field-ocean': atmosphere(.90, .6, .88),
        '--field-lower': atmosphere(.65, .90, .905),
        '--field-neutral': `color-mix(in oklab, ${atmosphere(.10, .5, .965)} 82%, ${atmosphere(.90, .6, .9)})`,
        '--transition-blur': `${clamp(width * .028, 10, 28).toFixed(2)}px`,
        // A light material remains safe for both very dark and bright sources.
        '--field-exposure': String(clamp(1.15 + (.65 - analysis.avgL) * .5, 1.12, 1.42)),
        '--text-guard-width': `${Math.min(66, p.clearStart * 100 + 5).toFixed(2)}%`
    };
}

export function storyPhotoSource(img, analysis, bakedHero = '') {
    // Framed artwork uses the existing intentional frame crop; photographs
    // use the actual thumbnail, preserving the clear region's original pixels.
    if (analysis.crop?.some(value => value > 0)) return bakedHero;
    const source = img.currentSrc || img.src;
    return /^(https?:|blob:|data:image\/|\/)/.test(source) ? source : bakedHero;
}

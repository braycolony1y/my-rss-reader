// The tall left ellipse never encloses the photo. An independent, feathered
// Bezier contour owns the lower edge; CSS intersects their alpha fields.
export function desktopLeftMask({ soft = false } = {}) {
    return `radial-gradient(ellipse ${soft ? '99% 192%' : '98% 182%'} at 100% 42%, #000 0%, #000 54%, rgb(0 0 0 / .995) 59%, rgb(0 0 0 / .97) 63%, rgb(0 0 0 / .91) 67%, rgb(0 0 0 / .82) 71%, rgb(0 0 0 / .70) 75%, rgb(0 0 0 / .56) 79%, rgb(0 0 0 / .42) 83%, rgb(0 0 0 / .29) 87%, rgb(0 0 0 / .18) 90%, rgb(0 0 0 / .10) 93%, rgb(0 0 0 / .045) 96%, rgb(0 0 0 / .012) 98%, transparent 100%)`;
}

export function desktopBottomMask({ soft = false } = {}) {
    // The contour stays around 90–95% of source height. Its Gaussian tail
    // finishes before the physical source edge, without a linear bottom fade.
    // The solid upper field prevents SVG filter clipping at the top boundary.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${soft ? 14 : 11}"/></filter></defs><rect width="1000" height="820" fill="white"/><path fill="white" filter="url(#b)" transform="translate(0 ${soft ? -8 : 0})" d="M -120 -120 H 1120 V 944 C 920 963, 810 925, 640 933 C 440 943, 340 908, 200 914 C 60 920, -30 886, -120 894 Z"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function desktopPhotoEnvelope(options) {
    return `${desktopLeftMask(options)}, ${desktopBottomMask(options)}`;
}

export function desktopMaskProperties() {
    return {
        '--hero-left-mask': desktopLeftMask(),
        '--hero-bottom-mask': desktopBottomMask(),
        '--hero-soft-left-mask': desktopLeftMask({ soft: true }),
        '--hero-soft-bottom-mask': desktopBottomMask({ soft: true })
    };
}

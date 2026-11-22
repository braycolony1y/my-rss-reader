// Reuse scratch outputs in pixel loops. Public callers still receive a fresh
// array/object by default, with the same arithmetic and gamut search as before.
const linear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const byteLinear = Float64Array.from({ length: 256 }, (_, i) => linear(i));
const channel = v => Number.isInteger(v) && v >= 0 && v <= 255 ? byteLinear[v] : linear(v);

export function rgbToOklab(r, g, b, out = []) {
    r = channel(r); g = channel(g); b = channel(b);
    const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
    const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
    const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
    out[0] = .2104542553*l + .793617785*m - .0040720468*s;
    out[1] = 1.9779984951*l - 2.428592205*m + .4505937099*s;
    out[2] = .0259040371*l + .7827717662*m - .808675766*s;
    return out;
}

export function labToLinear([L, a, b], out = []) {
    const l = (L + .3963377774*a + .2158037573*b) ** 3;
    const m = (L - .1055613458*a - .0638541728*b) ** 3;
    const s = (L - .0894841775*a - 1.291485548*b) ** 3;
    out[0] = 4.0767416621*l - 3.3077115913*m + .2309699292*s;
    out[1] = -1.2684380046*l + 2.6097574011*m - .3413193965*s;
    out[2] = -.0041960863*l - .7034186147*m + 1.707614701*s;
    return out;
}

export function gamutMap(L, C, h, out = { L: 0, C: 0, h: 0, rgb: [0, 0, 0] }) {
    const angle = h * Math.PI / 180;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const lab = [L, 0, 0], values = out.rgb;
    const valid = c => {
        lab[1] = c * cosine; lab[2] = c * sine;
        labToLinear(lab, values);
        return values[0] >= -1e-7 && values[0] <= 1.0000001
            && values[1] >= -1e-7 && values[1] <= 1.0000001
            && values[2] >= -1e-7 && values[2] <= 1.0000001;
    };
    if (!valid(C)) {
        let low = 0, high = C;
        for (let i = 0; i < 20; i++) {
            const mid = (low + high) / 2;
            if (valid(mid)) low = mid; else high = mid;
        }
        C = low;
    }
    valid(C);
    for (let i = 0; i < 3; i++) {
        const v = values[i];
        values[i] = Math.round(255 * (v <= .0031308 ? 12.92*v : 1.055*Math.max(0,v)**(1/2.4)-.055));
    }
    out.L = L; out.C = C; out.h = h;
    return out;
}

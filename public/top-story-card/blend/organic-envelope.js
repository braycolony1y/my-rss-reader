// One native elliptical alpha field joins the curved left edge to the low
// bottom feather, keeping the crisp upper/right photograph inside one shape.
export function desktopPhotoEnvelope({ soft = false } = {}) {
    return soft
        ? 'radial-gradient(ellipse 96% 84% at 103% 18%, #000 81%, rgb(0 0 0 / .94) 86%, rgb(0 0 0 / .56) 91%, rgb(0 0 0 / .10) 95%, transparent 96.8%)'
        : 'radial-gradient(ellipse 92% 84% at 103% 18%, #000 85%, rgb(0 0 0 / .97) 87.5%, rgb(0 0 0 / .78) 91%, rgb(0 0 0 / .34) 94%, rgb(0 0 0 / .04) 96%, transparent 96.8%)';
}

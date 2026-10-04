const originals = new WeakMap();
// Standard, Classic and VOZ cards use the existing Top Story photo pipeline
// on desktop and mobile. Their templates still own which content and controls exist.
export function updateSharedCardStyle(card) {
    if (!card) return false;
    const win = card.ownerDocument.defaultView;
    const enabled = card.dataset.imageLayout === 'standard' && !!card.closest('.theme-glass-light')
        && (win.innerWidth < 768 || card.clientWidth >= 640);
    if (enabled) {
        const mode = win.innerWidth < 768 ? 'mobile' : 'desktop';
        if (card.dataset.sharedCardStyle !== mode) card.dataset.sharedCardStyle = mode;
    } else {
        delete card.dataset.sharedCardStyle;
        const previous = originals.get(card);
        if (previous) {
            for (const [key, value] of previous) {
                if (value) card.style.setProperty(key, value);
                else card.style.removeProperty(key);
            }
            originals.delete(card);
        }
    }
    return enabled;
}

// Restore the original palette when leaving the shared light-theme presentation.
export function rememberSharedProperties(card, css) {
    let previous=originals.get(card);
    if(!previous){previous=new Map();originals.set(card,previous);}
    for(const key of Object.keys(css))if(!previous.has(key))previous.set(key,card.style.getPropertyValue(key));
}

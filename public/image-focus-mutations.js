// Palette/focus/hero routines own styles inside the photo. Those writes must
// not retrigger their own layout pass; ResizeObserver handles box changes.
export function collectImageFocusMutations(records, selector) {
    const images = new Set(), added = new Set();
    let removed = false;
    for (const record of records) {
        const target = record.target;
        if (record.type === 'attributes') {
            if (target.matches?.(selector) && ['src', 'srcset'].includes(record.attributeName)) {
                images.add(target);
            } else if (!target.closest?.('.article-card-image') && !(record.attributeName === 'style' && target.matches?.('.article-card'))) {
                const image = target.closest?.('.article-card')?.querySelector(selector);
                if (image) images.add(image);
            }
        } else {
            const image = target.closest?.('.article-card')?.querySelector(selector);
            if (image) images.add(image);
            for (const node of record.addedNodes) if (node.nodeType === 1) added.add(node);
            removed ||= record.removedNodes.length > 0;
        }
    }
    return { images, added: [...added].filter(node => ![...added].some(parent => parent !== node && parent.contains(node))), removed };
}

// watch() already paints a newly discovered photo synchronously. A batch can
// contain both its insertion and its source/content mutation; repaint only
// photos that were tracked before this delivery to avoid a second layout pass.
export function applyImageFocusMutations(records, { selector, states, watch, scan, update, release }) {
    const { images, added, removed } = collectImageFocusMutations(records, selector);
    const existing = [...images].filter(img => states.has(img));
    const sources = new Set(records.filter(record =>
        ['src', 'srcset'].includes(record.attributeName) && images.has(record.target)
    ).map(record => record.target));
    for (const img of sources) {
        const state = states.get(img);
        if (state) state.source = null;
        watch(img);
    }
    added.forEach(scan);
    existing.forEach(update);
    if (removed) for (const [img, state] of states) {
        if (!img.isConnected) release(img, state);
    }
}

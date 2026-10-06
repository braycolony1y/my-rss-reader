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

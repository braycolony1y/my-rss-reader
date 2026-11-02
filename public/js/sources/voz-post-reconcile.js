// Keep live post/media identity across current-page refreshes. Source markup
// belongs to each node, so widget hydration and spoiler state are not mistaken
// for publisher edits. Weak ownership releases closed/replaced article trees.
const ReaderVozPostReconcile = (() => {
    const sources = new WeakMap();
    const identity = node => node.getAttribute('data-absolute-post-id') || node.id || '';
    function remember(root) {
        root.querySelectorAll('.voz-post').forEach(node => sources.set(node, node.outerHTML));
    }
    function reconcile(root, freshPosts, preserveHistory = false) {
        const current = Array.from(root.querySelectorAll('.voz-post'));
        const unique = nodes => {
            const result = new Map();
            for (const node of nodes) {
                const id = identity(node);
                if (!id || result.has(id)) return null;
                result.set(id, node);
            }
            return result;
        };
        const oldById = unique(current), freshById = unique(freshPosts);
        if (!oldById || !freshById) return { changed: false, invalid: true };
        const after = new Map(), leading = [];
        if (preserveHistory) {
            let previousLive = '';
            for (const node of current) {
                const id = identity(node);
                if (freshById.has(id)) previousLive = id;
                else if (previousLive) {
                    if (!after.has(previousLive)) after.set(previousLive, []);
                    after.get(previousLive).push(node);
                } else leading.push(node);
            }
        }
        const desired = [...leading];
        for (const fresh of freshPosts) {
            const id = identity(fresh), old = oldById.get(id), markup = fresh.outerHTML;
            const retain = old && (preserveHistory || (sources.get(old) || old.outerHTML) === markup);
            const node = retain ? old : root.ownerDocument.importNode(fresh, true);
            if (!retain) sources.set(node, markup);
            desired.push(node, ...(after.get(id) || []));
        }
        if (desired.length === current.length && desired.every((node, i) => node === current[i])) {
            return { changed: false };
        }
        // Read an anchor before writes. Corrections happen only for a structural
        // refresh, never on the scrolling path or on an unchanged response.
        const scroll = root.closest('#overlay-scroll-container');
        const top = scroll?.getBoundingClientRect().top;
        const anchor = top === undefined ? null : current.find(node =>
            desired.includes(node) && node.getBoundingClientRect().bottom > top);
        const before = anchor?.getBoundingClientRect().top;
        const wanted = new Set(desired);
        for (const node of current) if (!wanted.has(node)) node.remove();
        let cursor = Array.from(root.children).find(node => node.matches('.voz-post')) || null;
        for (const node of desired) {
            if (node === cursor) cursor = cursor.nextElementSibling;
            else root.insertBefore(node, cursor);
        }
        if (anchor?.isConnected) {
            const delta = anchor.getBoundingClientRect().top - before;
            if (Math.abs(delta) > 0.5) scroll.scrollTop += delta;
        }
        return { changed: true, html: root.innerHTML };
    }
    return { remember, reconcile };
})();

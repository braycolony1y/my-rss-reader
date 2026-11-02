// One owner inserts article HTML. Background post reconciliation adopts its
// existing DOM before publishing overlayContent, avoiding a second x-html
// replacement of the same reader tree.
const ReaderArticleContent = (() => {
    const committed = new WeakMap();
    const restorations = new WeakMap();
    function cancelRestore(scroll) {
        const state = scroll && restorations.get(scroll);
        if (!state) return;
        if (state.frame) cancelAnimationFrame(state.frame);
        for (const type of ['wheel', 'touchstart', 'keydown']) scroll.removeEventListener(type, state.input);
        scroll.style.overflowAnchor = state.previous;
        restorations.delete(scroll);
    }
    function beginRestore(scroll) {
        if (!scroll) return null;
        cancelRestore(scroll);
        const state = { previous: scroll.style.overflowAnchor, pending: true,
            input: () => cancelRestore(scroll) };
        restorations.set(scroll, state);
        for (const type of ['wheel', 'touchstart', 'keydown']) {
            scroll.addEventListener(type, state.input, { passive: true });
        }
        // An explicit saved-position restore owns this content replacement.
        // Otherwise the browser can also subtract the old article's widget
        // height from the restored offset at the next rendering boundary.
        scroll.style.overflowAnchor = 'none';
        return state;
    }
    function restorePosition(scroll, state, top) {
        if (!scroll || restorations.get(scroll) !== state) return;
        // Alpine x-show can still have a pending visibility write at nextTick.
        // Committing before that write clamps a valid saved offset to zero.
        // Queue one owned commit after those visibility callbacks; input or a
        // replacement reader cancels it instead of fighting the user's scroll.
        state.frame = requestAnimationFrame(() => {
            if (restorations.get(scroll) !== state) return;
            scroll.scrollTop = top || 0;
            state.pending = false;
            state.frame = requestAnimationFrame(() => {
                if (restorations.get(scroll) !== state) return;
                state.frame = requestAnimationFrame(() => {
                    if (restorations.get(scroll) === state) cancelRestore(scroll);
                });
            });
        });
    }
    function render(root, value) {
        const html = value || '';
        if (committed.get(root) === html) return;
        const update = () => {
            if (window.Alpine) Array.from(root.children).forEach(node => Alpine.destroyTree(node));
            root.innerHTML = html;
            ReaderVozPostReconcile.remember(root);
            committed.set(root, html);
            if (window.Alpine) {
                root._x_ignoreSelf = true;
                try { Alpine.initTree(root); } finally { delete root._x_ignoreSelf; }
            }
        };
        if (window.Alpine) Alpine.mutateDom(update);
        else update();
    }
    return { render, beginRestore, restorePosition, cancelRestore,
        positionPending(scroll) { return Boolean(restorations.get(scroll)?.pending); },
        adopt(root, html) { committed.set(root, html); } };
})();

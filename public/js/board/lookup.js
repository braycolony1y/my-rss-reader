// Board collections are replaced on server sync, optimistic edits and rollback.
// Index each immutable collection once, without retaining obsolete generations.
const ReaderBoardLookup = (() => {
    const members = new WeakMap(), folders = new WeakMap();
    const raw = value => window.Alpine?.raw?.(value) || value;
    return {
        members(values, identity) {
            values = raw(values);
            let index = members.get(values);
            if (!index) {
                index = new Set(values.map(identity));
                members.set(values, index);
            }
            return index;
        },
        folders(values, identity) {
            values = raw(values);
            let index = folders.get(values);
            if (!index) {
                index = new Map();
                for (const [url, folder] of Object.entries(values)) {
                    const id = identity(url);
                    // Preserve the original first-match behavior for aliases.
                    if (!index.has(id)) index.set(id, folder);
                }
                folders.set(values, index);
            }
            return index;
        }
    };
})();

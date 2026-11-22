// Give legacy in-memory feed fixtures the same serialized updater boundary.
export function addMemoryUpdates(db, values) {
    let tail = Promise.resolve();
    db.updateMany = (keys, update) => {
        const pending = tail.then(() => db.putMany(update(Object.fromEntries(
            keys.map(key => [key, structuredClone(values[key] ?? null)])))));
        tail = pending.catch(() => {});
        return pending;
    };
    return db;
}

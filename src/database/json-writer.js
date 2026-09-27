import fs from 'node:fs/promises';

// Database values are already serialized JSON strings. Escape them in small
// pieces instead of allocating and serializing the entire database at once.
// Awaiting each batch also lets HTTP requests run while snapshots are written.
export async function writeJsonSnapshot(filename, value) {
    const handle = await fs.open(filename, 'w');
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.toJSON === 'function') {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            if (typeof value === 'string') JSON.parse(value);
            await handle.writeFile(serialized, 'utf8');
            return;
        }
        let batch = '';
        const ancestors = new Set();
        function* encode(item, key = '', converted = false) {
            if (!converted && item && typeof item.toJSON === 'function') item = item.toJSON(key);
            if (typeof item === 'string') {
                yield '"';
                for (let offset = 0; offset < item.length; offset += 64 * 1024) {
                    yield JSON.stringify(item.slice(offset, offset + 64 * 1024)).slice(1, -1);
                }
                yield '"';
            } else if (item && typeof item === 'object' &&
                (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
                if (ancestors.has(item)) throw new TypeError('Converting circular structure to JSON');
                ancestors.add(item);
                const array = Array.isArray(item);
                yield array ? '[' : '{';
                let first = true;
                for (const property of array ? Array.from({length: item.length}, (_, i) => String(i)) : Object.keys(item)) {
                    let child = item[property];
                    if (child && typeof child.toJSON === 'function') child = child.toJSON(property);
                    if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
                        if (!array) continue;
                        child = null;
                    }
                    yield `${first ? '' : ','}${array ? '' : JSON.stringify(property) + ':'}`;
                    first = false;
                    yield* encode(child, property, true);
                }
                yield array ? ']' : '}';
                ancestors.delete(item);
            } else {
                yield JSON.stringify(item);
            }
        }
        for (const chunk of encode(value)) {
            batch += chunk;
            if (batch.length >= 256 * 1024) {
                await handle.writeFile(batch, 'utf8');
                batch = '';
            }
        }
        if (batch) await handle.writeFile(batch, 'utf8');
    } finally {
        await handle.close();
    }
}

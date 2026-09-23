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
        let batch = '{';
        let first = true;
        const flush = async () => {
            if (!batch) return;
            await handle.writeFile(batch, 'utf8');
            batch = '';
        };
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
            batch += `${first ? '' : ','}${JSON.stringify(key)}:`;
            first = false;
            if (typeof item === 'string') {
                batch += '"';
                for (let offset = 0; offset < item.length; offset += 64 * 1024) {
                    batch += JSON.stringify(item.slice(offset, offset + 64 * 1024)).slice(1, -1);
                    if (batch.length >= 256 * 1024) await flush();
                }
                batch += '"';
            } else {
                batch += JSON.stringify(item);
            }
            if (batch.length >= 256 * 1024) await flush();
        }
        batch += '}';
        await flush();
    } finally {
        await handle.close();
    }
}

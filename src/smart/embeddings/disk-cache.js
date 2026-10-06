import { createReadStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';

// The persisted format remains a flat JSON object of base64 vectors. Read a
// bounded chunk rather than materializing its entire history in each worker.
export async function* embeddingEntries(filename) {
    const stream = createReadStream(filename, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    let buffer = '', started = false, finished = false, afterComma = false;
    const entry = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*([,}])/;
    try {
        for await (const chunk of stream) {
            buffer += chunk;
            if (!started) {
                const start = /^\s*\{/.exec(buffer);
                if (!start) throw new SyntaxError('Invalid embedding cache object');
                buffer = buffer.slice(start[0].length); started = true;
            }
            if (!finished && !afterComma && /^\s*}/.test(buffer)) {
                buffer = buffer.replace(/^\s*}/, ''); finished = true;
            }
            while (!finished) {
                const match = entry.exec(buffer);
                if (!match) break;
                buffer = buffer.slice(match[0].length);
                afterComma = match[3] === ',';
                finished = !afterComma;
                yield { key: JSON.parse(match[1]), encodedJson: match[2] };
            }
            if (finished && buffer.trim()) throw new SyntaxError('Trailing embedding cache data');
            if (buffer.length > 256 * 1024) throw new SyntaxError('Invalid or oversized embedding cache entry');
        }
        if (!started || !finished || buffer.trim()) throw new SyntaxError('Incomplete embedding cache');
    } finally { stream.destroy(); }
}

export async function loadEmbeddingSubset(filename, keys, importEntries) {
    let entries = 0, matched = 0;
    for await (const { key, encodedJson } of embeddingEntries(filename)) {
        entries++;
        if (keys.has(key)) { importEntries({ [key]: JSON.parse(encodedJson) }); matched++; }
    }
    return { entries, matched };
}

// Keep unrelated historical vectors on disk. An interrupted/invalid merge
// never replaces the previous cache, and writes obey filesystem backpressure.
export async function mergeEmbeddingCache(filename, updates) {
    const temporary = `${filename}.tmp-${process.pid}`;
    const handle = await open(temporary, 'w');
    let count = 0, batch = '{';
    const emit = async (key, encodedJson) => {
        batch += `${count++ ? ',' : ''}${JSON.stringify(key)}:${encodedJson}`;
        if (batch.length >= 256 * 1024) { await handle.writeFile(batch, 'utf8'); batch = ''; }
    };
    try {
        try {
            for await (const entry of embeddingEntries(filename)) {
                if (!Object.hasOwn(updates, entry.key)) await emit(entry.key, entry.encodedJson);
            }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const [key, value] of Object.entries(updates)) await emit(key, JSON.stringify(value));
        await handle.writeFile(batch + '}', 'utf8');
        await handle.close();
        await rename(temporary, filename);
        return count;
    } catch (error) {
        await handle.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

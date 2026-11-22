import fs from 'node:fs/promises';
import path from 'node:path';

const FORMAT = 'rss-keyed-overlay-v1';
async function syncPath(filename) {
    const handle = await fs.open(filename, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}

// Immutable per-key parts become visible together through one atomic manifest.
// Large unchanged ledger/cache values are not rewritten with each small update.
export function createKeyedOverlay({filename, allowedKeys, writeJson}) {
    const directory = path.join(path.dirname(filename), 'database_state', path.basename(filename));
    let references = {};
    const validPart = (key, name) => allowedKeys.has(key) && typeof name === 'string'
        && new RegExp(`^\\d+\\.${key}\\.json$`).test(name) && path.basename(name) === name;
    const remove = async names => {
        for (const name of names) await fs.unlink(path.join(directory, name)).catch(error => {
            if (error.code !== 'ENOENT') console.warn('[DB OVERLAY CLEANUP]', error.message);
        });
    };
    return {
        async load(minRevision = -1) {
            const manifest = JSON.parse(await fs.readFile(filename, 'utf8'));
            if (!Number.isSafeInteger(manifest.revision) || manifest.revision < 0) throw Error('Invalid overlay revision');
            if (!manifest.format && manifest.values && Object.keys(manifest.values).every(key => allowedKeys.has(key))) {
                references = {};
                return manifest;
            }
            if (manifest.format !== FORMAT || !manifest.files || !Object.entries(manifest.files).every(([key,name])=>validPart(key,name))) throw Error('Invalid overlay manifest');
            if (manifest.revision <= minRevision) { references = {}; return {revision:manifest.revision,values:{}}; }
            const values = {};
            for (const [key,name] of Object.entries(manifest.files)) {
                const record = JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
                if (!Object.hasOwn(record,'value')) throw Error('Invalid overlay part');
                values[key] = record.value;
            }
            references = manifest.files;
            return {revision:manifest.revision,values};
        },
        async write({revision,values,changedKeys}) {
            if (!Number.isSafeInteger(revision) || revision < 0 || Object.keys(values).some(key=>!allowedKeys.has(key))) throw Error('Invalid overlay update');
            await fs.mkdir(directory,{recursive:true});
            const changed = new Set(changedKeys), next = {}, created = [];
            let committed = false;
            try {
                for (const [key,value] of Object.entries(values)) {
                    if (references[key] && !changed.has(key)) { next[key] = references[key]; continue; }
                    const name = `${revision}.${key}.json`;
                    await writeJson(path.join(directory,name),{value});created.push(name);
                    await syncPath(path.join(directory,name));next[key] = name;
                }
                await syncPath(directory);
                // Persist the child directory entry before publishing its paths.
                await syncPath(path.dirname(directory));
                await syncPath(path.dirname(filename));
                await writeJson(filename,{format:FORMAT,revision,files:next});
                committed = true;
                const previous = references;references = next;
                // Do not roll memory back after the manifest is already visible.
                let durable = true;
                try { await syncPath(filename); await syncPath(path.dirname(filename)); }
                catch(error) { durable = false; console.warn('[DB OVERLAY SYNC]',error.message); }
                if (durable) await remove(Object.values(previous).filter(name=>!Object.values(next).includes(name)));
            } catch(error) {
                if (!committed) await remove(created);
                throw error;
            }
        },
        async clear() {
            await fs.unlink(filename).catch(error=>{if(error.code!=='ENOENT')throw error;});
            await syncPath(path.dirname(filename));
            const old = references;references = {};
            await remove(Object.values(old));
        }
    };
}

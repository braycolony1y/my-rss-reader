import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const CARD_COMPONENT_MARKER = '<!-- reader:article-card-component -->';
export const READER_ASSET_PATHS = Object.freeze({
    index: fileURLToPath(new URL('../../index.html', import.meta.url)),
    card: fileURLToPath(new URL('../../public/components/article-card.html', import.meta.url)),
    script: fileURLToPath(new URL('../../script.js', import.meta.url)),
    panels: fileURLToPath(new URL('../../public/article-panels.js', import.meta.url))
});

export function composeReaderHtml(index, card) {
    if (!index.includes(CARD_COMPONENT_MARKER)) throw new Error('Reader card component marker is missing');
    return index.replace(CARD_COMPONENT_MARKER, () => card);
}
export function composeReaderScript(script, panels) { return `${panels}\n${script}`; }

// Revalidate source files on shell requests. Feed/API requests do not do this
// work; unchanged assets reuse their already-composed strings.
export function createReaderAssetRenderer(paths = READER_ASSET_PATHS) {
    const cache = new Map();
    async function render(kind, names, compose) {
        const files = names.map(name => paths[name]);
        const versions = await Promise.all(files.map(file => stat(file)));
        const key = versions.map(s => `${s.mtimeMs}:${s.size}`).join('/');
        if (cache.get(kind)?.key === key) return cache.get(kind).value;
        const contents = await Promise.all(files.map(file => readFile(file, 'utf8')));
        const value = compose(...contents);
        cache.set(kind, { key, value });
        return value;
    }
    return {
        html: () => render('html', ['index','card'], composeReaderHtml),
        script: () => render('script', ['script','panels'], composeReaderScript)
    };
}

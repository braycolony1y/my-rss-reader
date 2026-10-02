import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { READER_CLIENT_MODULES } from './client-modules.js';
import { READER_COMPONENT_PATHS, composeReaderPartials } from './reader-partials.js';

export const CARD_COMPONENT_MARKER = '<!-- reader:article-card-component -->';
export const READER_ASSET_PATHS = Object.freeze({
    index: fileURLToPath(new URL('../../index.html', import.meta.url)),
    card: fileURLToPath(new URL('../../public/components/article-card.html', import.meta.url)),
    script: fileURLToPath(new URL('../../script.js', import.meta.url)),
    panels: fileURLToPath(new URL('../../public/article-panels.js', import.meta.url)),
    clientModules: READER_CLIENT_MODULES,
    components: READER_COMPONENT_PATHS
});

export function composeReaderHtml(index, card, partials = {}) {
    const html = composeReaderPartials(index, partials);
    if (!html.includes(CARD_COMPONENT_MARKER)) throw new Error('Reader card component marker is missing');
    return html.replace(CARD_COMPONENT_MARKER, () => card);
}
export function composeReaderScript(script, panels, modules = []) {
    return [panels, ...modules, script].join('\n');
}

// Revalidate source files on shell requests. Feed/API requests do not do this
// work; unchanged assets reuse their already-composed strings.
export function createReaderAssetRenderer(paths = READER_ASSET_PATHS) {
    const cache = new Map();
    const components = Object.entries(paths.components || {});
    async function render(kind, files, compose) {
        const versions = await Promise.all(files.map(file => stat(file)));
        const key = versions.map(s => `${s.mtimeMs}:${s.size}`).join('/');
        if (cache.get(kind)?.key === key) return cache.get(kind).value;
        const contents = await Promise.all(files.map(file => readFile(file, 'utf8')));
        const value = compose(...contents);
        cache.set(kind, { key, value });
        return value;
    }
    return {
        html: () => render('html', [paths.index, paths.card, ...components.map(([, file]) => file)],
            (index, card, ...contents) => composeReaderHtml(index, card,
                Object.fromEntries(components.map(([name], i) => [name, contents[i]])))),
        script: () => render('script', [paths.script, paths.panels, ...(paths.clientModules || [])],
            (script, panels, ...modules) => composeReaderScript(script, panels, modules))
    };
}

import { readFileSync } from 'node:fs';
import { READER_ASSET_PATHS, composeReaderHtml, composeReaderScript } from '../../src/ui/reader-assets.js';
export function readReaderHtml() {
    const html = composeReaderHtml(readFileSync(READER_ASSET_PATHS.index,'utf8'), readFileSync(READER_ASSET_PATHS.card,'utf8'),
        Object.fromEntries(Object.entries(READER_ASSET_PATHS.components).map(([name, file]) => [name, readFileSync(file, 'utf8')])));
    // Legacy source-contract and isolated-card tests inspect the effective CSS.
    // Inline only the extracted styles in this test view, in document order.
    return html.replace(/<link rel="stylesheet" href="(\/public\/styles\/[^"?]+)(?:\?[^" ]*)?">/g,
        (_, pathname) => `<style>${readFileSync(new URL('../..' + pathname, import.meta.url), 'utf8')}</style>`);
}
export function readReaderClientSource() {
    return composeReaderScript(readFileSync(READER_ASSET_PATHS.script,'utf8'), readFileSync(READER_ASSET_PATHS.panels,'utf8'),
        READER_ASSET_PATHS.clientModules.map(file => readFileSync(file, 'utf8')));
}

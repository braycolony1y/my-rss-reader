import { readFileSync } from 'node:fs';
import { READER_ASSET_PATHS, composeReaderHtml, composeReaderScript } from '../../src/ui/reader-assets.js';
export function readReaderHtml() {
    return composeReaderHtml(readFileSync(READER_ASSET_PATHS.index,'utf8'), readFileSync(READER_ASSET_PATHS.card,'utf8'));
}
export function readReaderClientSource() {
    return composeReaderScript(readFileSync(READER_ASSET_PATHS.script,'utf8'), readFileSync(READER_ASSET_PATHS.panels,'utf8'));
}

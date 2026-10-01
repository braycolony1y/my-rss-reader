import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { CARD_COMPONENT_MARKER, composeReaderHtml, createReaderAssetRenderer } from '../src/ui/reader-assets.js';

test('reader shell composes the card module and picks up subsequent component edits', async t => {
    const directory = await mkdtemp(path.join(tmpdir(),'rss-reader-assets-'));
    t.after(() => rm(directory,{recursive:true,force:true}));
    const paths = Object.fromEntries(['index','card','script','panels'].map(name => [name,path.join(directory,name)]));
    await Promise.all([
        writeFile(paths.index,`<main>${CARD_COMPONENT_MARKER}</main>`),
        writeFile(paths.card,'<article>First card</article>'),
        writeFile(paths.panels,'globalThis.panelValue = () => 42;'),
        writeFile(paths.script,'globalThis.answer = panelValue();')
    ]);
    const renderer = createReaderAssetRenderer(paths);
    assert.equal(await renderer.html(),'<main><article>First card</article></main>');
    await writeFile(paths.card,'<article>Updated card component</article>');
    assert.equal(await renderer.html(),'<main><article>Updated card component</article></main>');
    const context = vm.createContext({});
    vm.runInContext(await renderer.script(),context);
    assert.equal(context.answer,42,'the panel module is available before the legacy factory executes');
    assert.throws(() => composeReaderHtml('<main></main>','card'),/marker is missing/);
});

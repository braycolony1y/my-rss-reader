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

test('renderer invalidates nested partials and client modules without caching stale output', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rss-reader-modules-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const paths = Object.fromEntries(['index', 'card', 'script', 'panels', 'shell', 'nested', 'feature'].map(name => [name, path.join(directory, name)]));
    paths.components = { shell: paths.shell, nested: paths.nested };
    paths.clientModules = [paths.feature];
    await Promise.all([
        writeFile(paths.index, '<body><!-- reader:include shell -->\n</body>'),
        writeFile(paths.shell, `<main><!-- reader:include nested -->\n${CARD_COMPONENT_MARKER}</main>`),
        writeFile(paths.nested, '<nav>Initial navigation</nav>'), writeFile(paths.card, '<article>Card</article>'),
        writeFile(paths.panels, ''), writeFile(paths.feature, 'const Feature = { answer: 41 };'),
        writeFile(paths.script, 'globalThis.answer = Feature.answer;')
    ]);
    const renderer = createReaderAssetRenderer(paths);
    assert.equal(await renderer.html(), '<body><main><nav>Initial navigation</nav><article>Card</article></main></body>');
    await writeFile(paths.nested, '<nav>Changed nested navigation</nav>');
    assert.match(await renderer.html(), /Changed nested navigation/);
    const run = async () => { const context = vm.createContext({}); vm.runInContext(await renderer.script(), context); return context.answer; };
    assert.equal(await run(), 41);
    await writeFile(paths.feature, 'const Feature = { answer: 420 };');
    assert.equal(await run(), 420);
});

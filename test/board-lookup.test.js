import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('Board indexes preserve aliases, replacement, optimistic edits and rollback without repeated URL scans', () => {
    const context = vm.createContext({window: {}, URL});
    for (const name of ['lookup','folders']) vm.runInContext(readFileSync(new URL(`../public/js/board/${name}.js`, import.meta.url),'utf8'),context);
    const app = vm.runInContext('ReaderBoardFolders.create()',context);
    app.normalizeStateLink = value => value.split('#')[0];
    app.boardStates = ['https://voz.vn/t/example.123/page-2'];
    app.userPreferences = {boardFolderMappings:{'https://voz.vn/t/example.123/page-2':'first','https://voz.vn/t/123/':'second'}};
    const original = app.boardIdentity.bind(app); let calls = 0;
    app.boardIdentity = value => {calls++; return original(value);};
    assert.equal(app.isOnBoard('https://voz.vn/t/123/unread'),true);
    assert.equal(app.boardFolderFor('https://voz.vn/t/123/'), 'first');
    calls = 0;
    for (let i=0;i<100;i++) {app.isOnBoard('https://voz.vn/t/123/');app.boardFolderFor('https://voz.vn/t/123/');}
    assert.equal(calls,200);
    const previous = app.boardStates;
    app.applyBoardFolderResult({thread_id:'id',url:'https://example.test/new'}, {link:'https://example.test/new'}, 'saved');
    assert.equal(app.isOnBoard('https://example.test/new'),true);
    assert.equal(app.boardFolderFor('https://example.test/new'),'saved');
    app.boardStates = previous;
    assert.equal(app.isOnBoard('https://example.test/new'),false);
    app.applyBoardFolderResult({thread_id:'id'}, {link:'https://voz.vn/t/123/'}, null);
    assert.equal(app.isOnBoard('https://voz.vn/t/123/'),false);
    assert.equal(app.boardFolderFor('https://voz.vn/t/123/'),null);
});

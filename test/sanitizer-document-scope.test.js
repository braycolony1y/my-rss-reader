import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {createSanitizerDocumentScope} from '../src/articles/sanitizer-document-scope.js';
import {createPostMarkupCleaner} from '../src/articles/post-markup-cleaner.js';

test('completed sanitizations release named temporary nodes and preserve ids, names, and output', () => {
    const window = new JSDOM('<p id="primary">Keep primary document</p>').window;
    const clean = createPostMarkupCleaner({window});
    try {
        for (let index = 0; index < 200; index++) {
            const html = `<div id="completed-post"><p>Post ${index}</p><img name="completed-image" src="https://example.test/image.png"></div>`;
            assert.equal(clean(html), html);
            assert.equal(window['completed-post'], undefined);
            assert.equal(window['completed-image'], undefined);
        }
        assert.equal(window.document.querySelector('#primary').textContent, 'Keep primary document');
    } finally {window.close();}
});

test('temporary documents are detached on a sanitization exception and the next call works', () => {
    const window = new JSDOM('').window;
    const purifier = createDOMPurify(window);
    const scoped = createSanitizerDocumentScope(window, purifier);
    const failure = new Error('controlled sanitizer failure');
    const fail = () => {throw failure;};
    try {
        purifier.addHook('uponSanitizeElement', fail);
        assert.throws(() => scoped(() => purifier.sanitize('<div id="failed-post">Failure</div>')), error => error === failure);
        assert.equal(window['failed-post'], undefined);
        purifier.removeHook('uponSanitizeElement', fail);
        assert.equal(scoped(() => purifier.sanitize('<div id="recovered-post">Recovered</div>')), '<div id="recovered-post">Recovered</div>');
        assert.equal(window['recovered-post'], undefined);
    } finally {window.close();}
});

test('cleanup uses unclobberable DOM methods and preserves the existing iframe policy', () => {
    const window = new JSDOM('').window;
    const clean = createPostMarkupCleaner({window});
    try {
        const output = clean('<form id="form-probe"><input name="ownerDocument"><input name="firstChild"><input name="removeChild"><img src="x" onerror="alert(1)"></form><iframe src="https://www.youtube.com/embed/test" srcdoc="unsafe"></iframe><iframe src="https://evil.example/embed"></iframe>');
        assert.match(output, /id="form-probe"/);
        assert.match(output, /youtube\.com\/embed\/test/);
        assert.match(output, /sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"/);
        assert.doesNotMatch(output, /onerror|srcdoc|evil\.example/);
        assert.equal(window['form-probe'], undefined);
        assert.equal(clean('plain text'), 'plain text');
        assert.equal(clean(null), '');
    } finally {window.close();}
});

test('DOM input is sanitized as a copy without detaching caller-owned documents', () => {
    const window = new JSDOM('<section id="caller-owned"><img src="x" onerror="unsafe()"></section>').window;
    const foreign = new JSDOM('<p id="foreign-owned">Foreign input</p>').window;
    const clean = createPostMarkupCleaner({window});
    try {
        const input = window.document.querySelector('section');
        const foreignInput = foreign.document.querySelector('p');
        assert.equal(clean(input), '<section id="caller-owned"><img src="x"></section>');
        assert.equal(clean(foreignInput), '<p id="foreign-owned">Foreign input</p>');
        assert.equal(window.document.querySelector('section'), input);
        assert.equal(input.firstChild.getAttribute('onerror'), 'unsafe()');
        assert.equal(window['caller-owned'], input);
        assert.equal(window['foreign-owned'], undefined);
        assert.equal(foreign.document.querySelector('p'), foreignInput);
    } finally {window.close(); foreign.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostSanitizer, sanitizePostMarkup } from '../src/articles/post-markup-sanitizer.js';

test('repeated post markup reuses a sanitized string while edits and eviction trigger fresh sanitation', () => {
    let calls = 0;
    const sanitizer = createPostSanitizer({ maxBytes: 48, clean: value => { calls++; return value; } });
    assert.equal(sanitizer.sanitizePostMarkup('one'), 'one');
    assert.equal(sanitizer.sanitizePostMarkup('one'), 'one'); assert.equal(calls, 1);
    sanitizer.sanitizePostMarkup('edited'); assert.equal(calls, 2);
    sanitizer.sanitizePostMarkup('abcdefghij');
    assert.ok(sanitizer.state().bytes <= 48);
    sanitizer.sanitizePostMarkup('one'); assert.equal(calls, 4);
    sanitizer.sanitizePostMarkup('x'.repeat(50)); sanitizer.sanitizePostMarkup('x'.repeat(50));
    assert.equal(calls, 6, 'oversized posts are sanitized on every read without retention');
});
test('cache hits retain sanitizer safety rules and changed unsafe content is independently checked', () => {
    const unsafe = '<p onclick="alert(1)">Post</p><script>alert(1)</script><iframe src="https://evil.example" srcdoc="attack"></iframe>';
    const first = sanitizePostMarkup(unsafe);
    assert.equal(sanitizePostMarkup(unsafe), first);
    assert.ok(!/onclick|<script|<iframe|srcdoc/.test(first));
    const safeEmbed = sanitizePostMarkup('<iframe src="https://www.youtube.com/embed/example" srcdoc="attack"></iframe>');
    assert.match(safeEmbed, /sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"/);
    assert.ok(!safeEmbed.includes('srcdoc'));
});

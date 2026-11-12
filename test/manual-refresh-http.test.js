import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('manual refresh HTTP preserves failed verification cooldowns and clears accepted successes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rss-manual-http-'));
    try {
        const {stdout, stderr} = await promisify(execFile)(process.execPath,
            [fileURLToPath(new URL('./helpers/manual-refresh-http-runtime.js', import.meta.url))], {
                cwd: directory, timeout: 90000, maxBuffer: 1024 * 1024,
                env: {...process.env, ANTIGRAVITY_ENABLED: 'false', GEMINI_WEB_ENABLED: 'false', SMART_LOCAL_AI_ENABLED: 'false'}
            });
        assert.match(stdout, /MANUAL_REFRESH_HTTP_OK/);
        assert.doesNotMatch(stdout + stderr, /\[FATAL\]|ReferenceError|Unhandled/);
    } finally {await rm(directory, {recursive: true, force: true});}
});

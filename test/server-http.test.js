import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

test('HTTP application integrates the extracted services in an isolated runtime', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rss-http-'));
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [fileURLToPath(new URL('./helpers/server-http-smoke.js', import.meta.url))], {
            cwd: directory,
            env: { ...process.env, ADMIN_PASSWORD: 'fixture-password' },
            timeout: 30000,
            maxBuffer: 1024 * 1024
        });
        assert.match(stdout, /HTTP_SMOKE_OK/);
        assert.doesNotMatch(stdout + stderr, /\[FATAL\]|ReferenceError|Unhandled/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

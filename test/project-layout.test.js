import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const allowedRootFiles = new Set([
    '.env',
    '.gitignore',
    'README.md',
    'article-media.js',
    'database.json',
    'database.json.backup',
    'database.writer.lock',
    'feed-parsers.js',
    'feed-worker.js',
    'feeds_backup.json',
    'feeds_backup.json.backup',
    'gemini.env',
    'gemini-keys.txt',
    'index.html',
    'package-lock.json',
    'package.json',
    'qwen-keys.txt',
    'script.js',
    'server.js',
    'smart-cluster-worker.js',
    'smart-data.json',
    'smart-data.json.backup',
    'smart-embedding-worker.js',
    'smart-embeddings-worker.json',
    'smart-hnsw-clustering.js',
    'smart-news.js',
    'smart-sources.js',
    'summary-engine.js',
    'tailwind.config.js'
]);

const allowedRootDirectories = new Set([
    '.agents',
    '.codex',
    '.git',
    '.vscode',
    'article_cache',
    'db_backups',
    'docs',
    'node_modules',
    'ops',
    'public',
    'src',
    'test',
    'tools'
]);

test('project root contains only documented production and workspace entries', async () => {
    const entries = await readdir(repositoryRoot, { withFileTypes: true });
    const unexpected = entries
        .filter((entry) => entry.isDirectory()
            ? !allowedRootDirectories.has(entry.name)
            : !allowedRootFiles.has(entry.name))
        .map((entry) => entry.name)
        .sort();

    assert.deepEqual(
        unexpected,
        [],
        `Move unexpected root entries to test/, tools/experiments/, ops/, /tmp, or the cleanup quarantine: ${unexpected.join(', ')}`
    );
});

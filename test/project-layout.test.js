import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const allowedRootFiles = new Set([
    '.git', // Git worktrees use a regular gitdir pointer file.
    '.env',
    '.gitignore',
    'README.md',
    'article-media.js',
    'database.json',
    'database-state.json',
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
    'script.js',
    'server.js',
    'smart-cluster-worker.js',
    'smart-state.json',
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
    '.aws', // Read-only credentials mount supplied by the execution environment.
    '.agents',
    '.codex',
    '.git',
    '.vscode',
    'article_cache',
    'db_backups',
    'database_state',
    'docs',
    'node_modules',
    'ops',
    'public',
    'src',
    'scripts',
    'test',
    'tools'
]);

test('project root contains only documented production and workspace entries', async () => {
    const entries = await readdir(repositoryRoot, { withFileTypes: true });
    const linkedNodeModules = await stat(path.join(repositoryRoot,'node_modules')).then(info=>info.isDirectory(),()=>false);
    const unexpected = entries
        // The live database writer briefly stages these atomic runtime files.
        .filter(entry => !/^smart-embeddings-worker\.json\.tmp-\d+$/.test(entry.name))
        .filter(entry => !/^(?:database\.json|database-state\.json|smart-state\.json|smart-data\.json|feeds_backup\.json)(?:\.backup)?\.tmp-\d+-[a-z0-9]+$/.test(entry.name))
        .filter((entry) => (entry.isDirectory() || entry.name==='node_modules' && entry.isSymbolicLink() && linkedNodeModules)
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

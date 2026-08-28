import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('embedding cache is stored in its own file instead of the main database', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rss-embedding-cache-'));
  const cacheFile = path.join(directory, 'embeddings.json');
  process.env.SMART_EMBEDDING_CACHE_FILE = cacheFile;

  try {
    const writer = await import(`../smart-news.js?embedding-writer=${Date.now()}`);
    const vector = new Float32Array([0.25, -0.5, 1]);
    writer.importEmbeddingCache({
      example: Buffer.from(
        vector.buffer,
        vector.byteOffset,
        vector.byteLength
      ).toString('base64')
    });

    await writer.saveEmbeddings({
      put() {
        throw new Error('embedding cache must not be written to the database');
      }
    });

    const stored = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.equal(typeof stored.example, 'string');

    const reader = await import(`../smart-news.js?embedding-reader=${Date.now()}`);
    await reader.loadEmbeddings({
      get() {
        throw new Error('embedding cache must not be read from the database');
      }
    });
    assert.equal(reader.exportEmbeddingCache().example, stored.example);
  } finally {
    delete process.env.SMART_EMBEDDING_CACHE_FILE;
    await rm(directory, { recursive: true, force: true });
  }
});

import { withLocalCompute } from '../../ai/local-compute.js';
import { boundedWorkerOptions } from '../../observability/memory-budget.js';
import { cleanTitleForScoring, stripHtml } from '../text/normalize.js';
import { EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, EMBEDDING_BATCH_SIZE, EMBEDDING_CACHE_FILE } from './config.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

let embeddingPipeline = null;

const embeddingCache = new Map();

function buildEmbeddingText(article) {
  const title = cleanTitleForScoring(article?.title || '');
  const description = stripHtml(
    article?.description ||
    article?.summary ||
    article?.content ||
    ''
  ).replace(/\s+/g, ' ').trim().slice(0, 500);

  return `query: ${[title, description].filter(Boolean).join('. ')}`;
}

function embeddingCacheKey(article) {
  return createHash('sha256')
    .update([
      EMBEDDING_MODEL,
      EMBEDDING_CACHE_VERSION,
      buildEmbeddingText(article)
    ].join('\n'))
    .digest('hex');
}

let embeddingWorker = null;

let workerMsgId = 0;

const workerPromises = new Map();

function disposeEmbeddingModel() {
  // Keep the embedding worker alive for the lifetime of this Node process.
  //
  // @xenova/transformers 2.17.2 uses onnxruntime-node 1.14.0, whose ARM64
  // native addon cannot be loaded successfully by a replacement Worker
  // after the first embedding Worker has been terminated.
  //
  // Reusing one persistent Worker also avoids repeatedly loading the E5 model.
  return;
}

function getEmbeddingWorker() {
  if (embeddingWorker) return embeddingWorker;

  embeddingWorker = new Worker(new URL('../../../smart-embedding-worker.js', import.meta.url), { type: 'module', ...boundedWorkerOptions(512) });

  embeddingWorker.on('message', (msg) => {
    if (msg.type === 'pong') return;
    const p = workerPromises.get(msg.id);
    if (!p) return;
    workerPromises.delete(msg.id);

    if (msg.type === 'error') {
      p.reject(new Error(msg.error?.message || 'Worker error'));
    } else if (msg.type === 'result') {
      p.resolve(msg.vectors);
    }
  });

  embeddingWorker.on('error', (err) => {
    console.error('[SMART EMBEDDING WORKER] Error:', err.message);
    workerPromises.forEach(p => p.reject(new Error('Worker crashed')));
    workerPromises.clear();
    embeddingWorker = null;
  });

  embeddingWorker.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[SMART EMBEDDING WORKER] Exited with code ${code}`);
    }
    workerPromises.forEach(p => p.reject(new Error(`Worker exited with code ${code}`)));
    workerPromises.clear();
    embeddingWorker = null;
  });

  return embeddingWorker;
}

async function getEmbeddingVector(texts) {
  return withLocalCompute(
    'xenova-embedding',
    async () => {
  if (!texts || (Array.isArray(texts) && texts.length === 0)) return null;

  const worker = getEmbeddingWorker();
  const id = ++workerMsgId;
  const timeoutMs = Number(process.env.SMART_EMBEDDING_JOB_TIMEOUT_MS) || 120000;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      workerPromises.delete(id);
      reject(new Error('Embedding worker job timeout'));
    }, timeoutMs);

    workerPromises.set(id, {
      resolve: (res) => {
        clearTimeout(timeout);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    });

    worker.postMessage({ type: 'embed', id, texts });
  });

    }
  );
}

async function prepareEmbeddings(
  articles,
  onProgress = null,
  checkpoint = null
) {
  const perfMonitor = monitorEventLoopDelay({ resolution: 10 });
  perfMonitor.enable();
  const startTime = Date.now();
  const entries = [];
  const seenKeys = new Set();
  let prepCounter = 0;

  for (const article of articles) {
    // If the article already has a valid vector attached, we don't need to re-embed.
    // Cache identity, rather than an attached vector, determines reuse.

    const text = buildEmbeddingText(article);
    const key = embeddingCacheKey(article);

    if (!seenKeys.has(key)) {
      seenKeys.add(key);

      entries.push({
        key,
        text
      });
    }

    prepCounter++;
    if (prepCounter % 50 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  const missing = entries.filter(
    entry => !embeddingCache.has(entry.key)
  );

  const throttleMs = Number(process.env.SMART_PROGRESS_THROTTLE_MS) || 250;
  let lastProgress = 0;

  let lastCheckpoint = Date.now();
  for (let start = 0; start < missing.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = missing.slice(start, start + EMBEDDING_BATCH_SIZE);

    const texts = batch.map(e => e.text);
    const vectors = await getEmbeddingVector(texts);

    if (vectors && vectors.length === batch.length) {
      for (let i = 0; i < batch.length; i++) {
        embeddingCache.set(batch[i].key, vectors[i]);
      }
    }

    if (checkpoint && (Date.now() - lastCheckpoint > 30000 || start + batch.length >= missing.length)) {
      await checkpoint();
      lastCheckpoint = Date.now();
    }
    // CRITICAL: Yield the event loop to prevent server lockup!
    await new Promise(r => setTimeout(r, 50));

    if (onProgress) {
      const now = Date.now();
      const isFinal = start + batch.length >= missing.length;
      if (isFinal || now - lastProgress > throttleMs) {
        lastProgress = now;
        onProgress({
          phase: 'embeddings',
          current: Math.min(start + batch.length, missing.length),
          total: missing.length
        });
      }
    }
  }

  for (const article of articles) {
    article._vec = embeddingCache.get(embeddingCacheKey(article)) || null;
  }

  perfMonitor.disable();
  const maxDelay = Math.round(perfMonitor.max / 1e6); // nanoseconds to ms
  console.log(`[SMART PERFORMANCE] stage=embeddings durationMs=${Date.now() - startTime} maxEventLoopDelayMs=${maxDelay}`);
  onProgress?.({ phase: 'embeddings', embeddingsReused: articles.length - missing.length, embeddingsGenerated: missing.length });
  console.log(`[SMART EMBEDDINGS] candidates=${articles.length} unique=${entries.length} hits=${entries.length - missing.length} misses=${missing.length} batches=${Math.ceil(missing.length / EMBEDDING_BATCH_SIZE)} durationMs=${Date.now() - startTime}`);
}

function importEmbeddingCache(stored) {
  if (
    !stored ||
    typeof stored !== 'object'
  ) {
    return;
  }

  for (
    const [key, encoded]
    of Object.entries(stored)
  ) {
    if (
      typeof encoded !== 'string' ||
      embeddingCache.has(key)
    ) {
      continue;
    }

    try {
      const buffer =
        Buffer.from(
          encoded,
          'base64'
        );

      const vector =
        new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.length / 4
        );

      embeddingCache.set(
        key,
        new Float32Array(vector)
      );
    } catch {
      // Ignore corrupted cache entries.
    }
  }
}

function exportEmbeddingCache() {
  const result = {};
  for (const [key, vector] of embeddingCache.entries()) {
    result[key] = Buffer.from(
      vector.buffer,
      vector.byteOffset,
      vector.byteLength
    ).toString('base64');
  }
  return result;
}

function clearEmbeddingCache() {
  embeddingCache.clear();
}

async function generateEmbeddingCacheJsonAsync() {
  let json = '{';
  let isFirst = true;
  let counter = 0;

  for (const [key, vector] of embeddingCache.entries()) {
    if (!isFirst) {
      json += ',';
    }
    isFirst = false;

    const base64 = Buffer.from(
      vector.buffer,
      vector.byteOffset,
      vector.byteLength
    ).toString('base64');

    json += `${JSON.stringify(key)}:"${base64}"`;

    counter++;
    if (counter % 50 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  json += '}';
  return json;
}

async function loadEmbeddings(db) {
  if (embeddingCache.size > 0) {
    return;
  }

  try {
    const stored = JSON.parse(
      await readFile(
        EMBEDDING_CACHE_FILE,
        'utf8'
      )
    );
    if (stored) {
      importEmbeddingCache(stored);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[SMART] Failed to load embedding cache:', error.message);
    }
  }
}

async function saveEmbeddings(db) {
  const temporaryPath =
    `${EMBEDDING_CACHE_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    const jsonString = await generateEmbeddingCacheJsonAsync();
    await writeFile(
      temporaryPath,
      jsonString,
      'utf8'
    );
    await rename(
      temporaryPath,
      EMBEDDING_CACHE_FILE
    );
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    console.error('[SMART] Failed to save embedding cache:', error.message);
  }
}

function pruneEmbeddingCache() {
  if (embeddingCache.size > 5000) {
    embeddingCache.clear();
  }
}

export { buildEmbeddingText, embeddingCacheKey, disposeEmbeddingModel, prepareEmbeddings, importEmbeddingCache, exportEmbeddingCache, clearEmbeddingCache, loadEmbeddings, saveEmbeddings, pruneEmbeddingCache };

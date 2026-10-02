import { fileURLToPath } from 'node:url';

const EMBEDDING_MODEL = process.env.SMART_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small';

const EMBEDDING_CACHE_VERSION = 'e5-query-title-content-v2';

const EMBEDDING_CACHE_FILE =
  process.env.SMART_EMBEDDING_CACHE_FILE ||
  fileURLToPath(
    new URL(
      '../../../smart-embeddings-worker.json',
      import.meta.url
    )
  );

const EMBEDDING_BATCH_SIZE = Math.max(
  1,
  Math.min(
    16,
    Number(process.env.SMART_EMBEDDING_BATCH_SIZE) || 8
  )
);

export { EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, EMBEDDING_CACHE_FILE, EMBEDDING_BATCH_SIZE };

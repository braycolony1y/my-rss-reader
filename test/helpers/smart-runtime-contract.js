import { EventEmitter } from 'node:events';

export async function captureSmartRuntimeContract(smart, fixture, { ambiguous = false } = {}) {
  const DateBefore = globalThis.Date;
  const fetchBefore = globalThis.fetch;
  const environment = Object.fromEntries(['SMART_ONLY_LOCAL', 'SMART_LOCAL_AI_ENABLED', 'GEMINI_API_KEY', 'GEMINI_WEB_ENABLED'].map(key => [key, process.env[key]]));
  const now = DateBefore.parse(fixture.now);
  globalThis.Date = class extends DateBefore {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  process.env.SMART_ONLY_LOCAL = 'true';
  process.env.SMART_LOCAL_AI_ENABLED = 'true';
  process.env.GEMINI_WEB_ENABLED = 'false';
  delete process.env.GEMINI_API_KEY;
  const stored = {};
  const writes = [];
  const notifications = [];
  const requests = [];
  const workerMessages = [];
  const db = {
    get: async (key, options) => stored[key] == null ? null : options?.type === 'json' ? JSON.parse(stored[key]) : stored[key],
    put: async (key, value) => { stored[key] = value; writes.push([key]); },
    putMany: async changes => { Object.assign(stored, changes); writes.push(Object.keys(changes)); }
  };
  const sources = ['news_vietnam', 'news_global', 'finance_vietnam', 'finance_global', 'tech_vietnam', 'tech_global'].map(destination => ({
    title: 'Fixture ' + destination, url: `https://fixture.test/${destination}.rss`,
    category: destination.startsWith('tech_') ? 'tech' : destination,
    region: destination.endsWith('vietnam') ? 'vietnam' : 'foreign', enabled: true
  }));
  const destinationOf = article => article.feedCategory === 'tech'
    ? article.language === 'vi' ? 'tech_vietnam' : 'tech_global' : article.feedCategory;
  const worker = new EventEmitter();
  worker.postMessage = message => {
    workerMessages.push({ type: message.type, mode: message.mode,
      articleKeys: message.articles.map(article => article.articleKey), existingCount: message.existingClusters.length });
    const duplicates = message.articles.filter(article => /metro-[12]$/.test(article.link));
    const groups = message.articles.filter(article => !duplicates.includes(article)).map(article => ({ articles: [article] }));
    if (duplicates.length) groups.unshift({ articles: duplicates });
    queueMicrotask(() => worker.emit('message', { type: 'result', result: {
      autoMergedClusters: groups,
      ambiguousGroups: ambiguous ? [{ articles: message.articles.filter(article => /world\/deal$/.test(article.link)) }] : [],
      metrics: { embeddingsGenerated: message.articles.length }
    } }));
  };
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen2.5:3b' }] }) };
    if (address.endsWith('/api/chat')) {
      const request = JSON.parse(options.body);
      requests.push(request);
      const user = request.messages.find(message => message.role === 'user').content;
      const input = JSON.parse(user.slice(user.lastIndexOf('\n') + 1));
      if (input.articles) {
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({
          clusters: [{ articleIds: input.articles.map(article => article.id), confidence: 0.99 }], uncertain: false
        }) } }) };
      }
      const { events } = input;
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ assessments: events.map(event => ({
        id: event.id, destination: event.eligibleDestinations[0], relevance: 0.9,
        impact: 0.8, novelty: 0.7, confidence: 0.95, exclude: false, reason: 'Mock editorial response'
      })) }) } }) };
    }
    return { ok: true, text: async () => `<rss><item>${address}</item></rss>` };
  };
  try {
    const engine = smart.createSmartNewsEngine({ db, helpers: { fastParseRSS: text => {
      const source = sources.find(value => text.includes(value.url));
      return { items: fixture.articles.filter(article => destinationOf(article) === source?.url.split('/').pop().replace('.rss', '')) };
    } }, clusterWorkerFactory: () => worker });
    const defaults = await engine.getSourceSettings();
    stored.smartSources = JSON.stringify([...defaults.map(source => ({ ...source, enabled: false })), ...sources]);
    const first = await engine.sync(progress => notifications.push(JSON.parse(JSON.stringify(progress))));
    if (!first.ok) throw new Error('Golden refresh failed: ' + first.error);
    const status = await engine.getStatus();
    const second = await engine.sync(progress => notifications.push(JSON.parse(JSON.stringify(progress))));
    return JSON.parse(JSON.stringify({ first, status, second, notifications, writes, requests,
      workerMessages, stored: Object.fromEntries(Object.entries(stored).map(([key, value]) => {
        try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
      })) }));
  } finally {
    globalThis.Date = DateBefore;
    globalThis.fetch = fetchBefore;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

export function capturePrivateSmartContract(smart, fixture) {
  const articles = fixture.articles.slice(2, 6).map(({ vector, ...article }) => ({ ...article, _vec: Float32Array.from(vector) }));
  const group = { fullRepartition: true, articles, reviewUniverse: articles,
    deferredComponents: [[articles[0], articles[1]], [articles[2]], [articles[3]]] };
  const units = smart.buildComponentReviewUnits(group);
  return JSON.parse(JSON.stringify({
    sources: fixture.sources.map(smart.normalizeSmartSource),
    dates: fixture.dates.map(smart.parsePublishedTimestamp),
    text: ['<p>Hà Nội &amp; Việt Nam</p>', 'Tin mới: [Video] NHANH: công nghệ mới!!!', 'NASA launches NASA rocket'].map(text => ({
      stripped: smart.stripHtml(text), normalized: smart.normalizeText(text), cleaned: smart.cleanTitleForScoring(text), tokens: [...smart.titleTokens(text)]
    })),
    componentCacheKey: smart.componentVerificationCacheKey(group, units),
    configuration: { clustering: smart.SMART_NEWS_CLUSTER_CONFIG, ai: smart.SMART_NEWS_AI_CONFIG,
      version: smart.SMART_CLUSTER_VERSION, model: smart.EMBEDDING_MODEL,
      embeddingVersion: smart.EMBEDDING_CACHE_VERSION, batchSize: smart.EMBEDDING_BATCH_SIZE }
  }));
}

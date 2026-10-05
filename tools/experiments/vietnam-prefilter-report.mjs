import fs from 'node:fs/promises';
import { getPrefilterStore, evaluateCandidate, decisionsFor } from '../../src/smart/prefilter/state.js';

export async function reportCorpus(articles, section) {
  const values = {};
  const db = { get: async key => values[key] || null, put: async (key,value) => { values[key] = value; } };
  const store = await getPrefilterStore(db);
  const counts = { total: articles.length, kept: 0, excluded: 0, reused: 0, deterministicExclusions: 0, existingAiExclusions: 0, ambiguousKeeps: 0, excludedByReason: {} };
  const rows = [];
  for (const item of articles) {
    const article = { ...item };
    evaluateCandidate(store, article, [section]);
    const d = decisionsFor(article)[section];
    const excluded = d.status === 'exclude';
    counts[excluded ? 'excluded' : 'kept']++;
    if (excluded) {
      counts.excludedByReason[d.reasonCode] = (counts.excludedByReason[d.reasonCode] || 0) + 1;
      counts[d.decisionSource.startsWith('reused_') ? 'reused' : 'deterministicExclusions']++;
    } else if (!d.materialitySignals?.length) counts.ambiguousKeeps++;
    rows.push({ title:article.title, url:article.link, decision:excluded ? 'EXCLUDE' : 'KEEP', source:d.decisionSource, reason:d.reasonCode || d.materialitySignals?.join(', ') || 'ambiguous_keep' });
  }
  return { section, counts, rows };
}

const techText = await fs.readFile(new URL('../../test/fixtures/vietnam-prefilter/tech-vietnam-smart-top.tsv',import.meta.url),'utf8');
const tech = techText.trim().split('\n').map(line => { const [id,title,link] = line.split('\t'); return {id,title,link}; });
const data = JSON.parse(await fs.readFile(new URL('../../smart-data.json',import.meta.url),'utf8'));
const raw = typeof data.smartRawArticles === 'string' ? JSON.parse(data.smartRawArticles) : data.smartRawArticles;
const news = (raw || []).filter(a=>a.smartCategory==='news_vietnam');
await fs.writeFile(new URL('../../test/fixtures/vietnam-prefilter/news-vietnam-snapshot.json',import.meta.url), JSON.stringify(news.map(a=>({title:a.title,link:a.link,content:a.content,feedUrl:a.feedUrl,pubDate:a.pubDate})),null,2));
const results = [await reportCorpus(tech,'tech_vietnam'),await reportCorpus(news,'news_vietnam')];
const report = {generatedAt:new Date().toISOString(), mode:'Offline metadata-only; no fetching and no AI requests', results};
await fs.writeFile(new URL('../../docs/validation/vietnam-prefilter-corpus.json',import.meta.url),JSON.stringify(report,null,2));
await fs.writeFile(new URL('../../docs/validation/vietnam-prefilter-corpus.tsv',import.meta.url),['section\tdecision\tsource\treason\ttitle',...results.flatMap(r=>r.rows.map(row=>[r.section,row.decision,row.source,row.reason,row.title].map(x=>String(x).replace(/[\t\n]/g,' ')).join('\t')))].join('\n')+'\n');
console.log('CORPUS_SUMMARY',JSON.stringify(results.map(({section,counts})=>({section,...counts})),null,2));

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.argv[2] || '/tmp/rss-audit-20261006/api.json';
const rows = [];
async function request(label, route) {
    const start = performance.now();
    const res = await fetch(base + route, { headers: { Cookie: 'auth=true' }, signal: AbortSignal.timeout(90000) });
    const headersAt = performance.now();
    const text = await res.text();
    rows.push({ label, status: res.status, ttfbMs: headersAt - start, totalMs: performance.now() - start, bytes: Buffer.byteLength(text), serverTiming: res.headers.get('server-timing'), encoding: res.headers.get('content-encoding') });
    return JSON.parse(text);
}
const before = await request('resources', '/api/resources');
const first = await request('today-first', '/api/data?filterType=today&limit=30&hideRead=false');
const feed = first.feeds.find(f => first.articles.some(a => a.feedUrl === f.url)) || first.feeds[0];
for (let i = 0; i < 8; i++) {
    await request('today', '/api/data?filterType=today&limit=30&hideRead=false');
    await request('feed', '/api/data?' + new URLSearchParams({ filterType: 'feed', filterValue: feed.url, limit: '30', hideRead: 'false' }));
    await request('smart-top', '/api/data?filterType=smart&filterValue=tech_vietnam&smartMode=top&limit=30&hideRead=false');
}
const after = await request('resources', '/api/resources');
const stats = Object.fromEntries([...new Set(rows.map(r => r.label))].map(label => {
    const items = rows.filter(r => r.label === label);
    const quantiles = field => { const v=items.map(r=>r[field]).sort((a,b)=>a-b); return Object.fromEntries([['median',.5],['p75',.75],['p95',.95],['max',1]].map(([k,p])=>[k,Math.round(v[Math.ceil(p*v.length)-1]*10)/10])); };
    return [label, { n: items.length, ttfbMs: quantiles('ttfbMs'), totalMs: quantiles('totalMs'), bytes: quantiles('bytes') }];
}));
await writeFile(output, JSON.stringify({ at: new Date().toISOString(), base, before, after, feed: {title: feed.title, url:feed.url}, rows, stats, articles: first.articles.map(a=>({title:a.title,link:a.link,feedUrl:a.feedUrl})) },null,2));
console.log(JSON.stringify(stats,null,2));

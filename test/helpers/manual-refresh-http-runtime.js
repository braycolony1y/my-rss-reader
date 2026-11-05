import fs from 'node:fs/promises';
import {createApplication} from '../../src/app.js';
import {verifyManualRefreshHttp} from './manual-refresh-smoke.js';

const feedUrl = 'https://manual.example.test/feed.xml';
const snapshot = {feeds: [{url: feedUrl, title: 'Manual refresh fixture', category: 'Forum'}],
    articles: [], smartSources: [], smartClusters: [], smartRawArticles: [],
    readStates: [], savedStates: [], hiddenStates: [], boardStates: [], userPreferences: {}};
await fs.writeFile('database.json', JSON.stringify(Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key, JSON.stringify(value)]))));
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
    if (String(url) !== feedUrl) throw Error('Unexpected external request in manual refresh fixture');
    return new Response('<rss><channel><title>Manual refresh fixture</title><item><title>Recovered story</title>'
        + '<link>https://manual.example.test/article</link></item></channel></rss>');
};
const application = await createApplication();
const server = application.app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
try {
    await verifyManualRefreshHttp(async (endpoint, {method = 'GET', body} = {}) => {
        const response = await realFetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
            method, headers: {Cookie: 'auth=true', 'Content-Type': 'application/json'},
            ...(body ? {body: JSON.stringify(body)} : {})
        });
        return {status: response.status, data: await response.json()};
    }, feedUrl);
    console.log('MANUAL_REFRESH_HTTP_OK');
} finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
process.exit(0);

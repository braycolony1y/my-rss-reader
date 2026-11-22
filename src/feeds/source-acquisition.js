import {backgroundPublisherFetch as fetch, backgroundPublisherCommand} from '../articles/background-publisher-fetch.js';
import {sourceCooldown} from '../articles/source-cooldown.js';
import {createManualPublisherRefresh} from '../articles/manual-publisher-refresh.js';
import {withPublisherFetchKind} from '../articles/publisher-fetch-context.js';
import {runPublisherFallbacks} from '../articles/publisher-fallbacks.js';
import sourceRegistry from '../sources/index.js';
import {discardResponseBody} from '../fetch-response.js';
import path from 'node:path';

export function createFeedSourceAcquisition({CF_PROXY_BASE, BROWSER_HEADERS, VIETSERVER_PROXY_BASE,
    fetchViaVietserver, execFileAsync, recordFetch, fetchFeedResponse}) {
    async function acquire(feed, {feedFetchStart, syncLogs}) {
        let response;
        const feedHandler = sourceRegistry.getHandler(feed.url);
        let feedData;

        // ============================================================================
        // 🆕 MORNINGSTAR FETCH LOGIC — TRY ALL METHODS
        // ============================================================================
        if (feedHandler?.fetchFeed) {
            feedData = await sourceCooldown.run(feed.url, () => feedHandler.fetchFeed(feed.url));
        } else if (feed.url.includes('morningstar.com') || feed.url.includes('morningstar.co.uk')) {
            if (!global.lastFetchTimeByUrl) global.lastFetchTimeByUrl = {};
            global.lastFetchTimeByUrl[feed.url] = Date.now();

            let fetchOptions = {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': '*/*' }
            };

            let msHtml = null;
            let msMethod = '';

            // Method 1: Direct fetch with Googlebot UA
            try {
                console.log(`[MORNINGSTAR DEBUG] Method 1: Direct fetch...`);
                const directRes = await fetch(feed.url, fetchOptions);
                if (directRes.ok) {
                    const text = await directRes.text();
                    if (text && text.length > 1000 && !text.includes('challenge.js')) {
                        msHtml = text;
                        msMethod = 'direct';
                        console.log(`[MORNINGSTAR DEBUG] ✅ Direct fetch succeeded (${text.length} bytes)`);
                    } else {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ Direct fetch returned WAF/challenge page`);
                    }
                } else {
                    console.log(`[MORNINGSTAR DEBUG] ⚠️ Direct fetch HTTP ${directRes.status}`);
                    await discardResponseBody(directRes);
                }
            } catch (e) {
                console.log(`[MORNINGSTAR DEBUG] ⚠️ Direct fetch error: ${e.message}`);
            }

            // Method 2: CF Proxy
            if (!msHtml) {
                try {
                    console.log(`[MORNINGSTAR DEBUG] Method 2: CF Proxy...`);
                    const cfRes = await fetch(CF_PROXY_BASE + encodeURIComponent(feed.url), fetchOptions);
                    if (cfRes.ok) {
                        const text = await cfRes.text();
                        if (text && text.length > 1000 && !text.includes('challenge.js')) {
                            msHtml = text;
                            msMethod = 'cf-proxy';
                            console.log(`[MORNINGSTAR DEBUG] ✅ CF Proxy succeeded (${text.length} bytes)`);
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ CF Proxy returned WAF/challenge page`);
                        }
                    } else {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ CF Proxy HTTP ${cfRes.status}`);
                        await discardResponseBody(cfRes);
                    }
                } catch (e) {
                    console.log(`[MORNINGSTAR DEBUG] ⚠️ CF Proxy error: ${e.message}`);
                }
            }

            // Method 3: Vietserver Proxy
            if (!msHtml && VIETSERVER_PROXY_BASE) {
                try {
                    console.log(`[MORNINGSTAR DEBUG] Method 3: Vietserver Proxy...`);
                    const vsText = await fetchViaVietserver(feed.url);
                    if (vsText && vsText.length > 1000 && !vsText.includes('challenge.js')) {
                        msHtml = vsText;
                        msMethod = 'vietserver';
                        console.log(`[MORNINGSTAR DEBUG] ✅ Vietserver succeeded (${vsText.length} bytes)`);
                    } else {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ Vietserver returned insufficient content`);
                    }
                } catch (e) {
                    console.log(`[MORNINGSTAR DEBUG] ⚠️ Vietserver error: ${e.message}`);
                }
            }

            // Method 4: Jina Reader
            if (!msHtml) {
                try {
                    console.log(`[MORNINGSTAR DEBUG] Method 4: Jina Reader...`);
                    const jinaUrl = `https://r.jina.ai/${feed.url}`;
                    const jinaController = new AbortController();
                    const jinaTimeout = setTimeout(() => jinaController.abort(), 15000);
                    const jinaRes = await fetch(jinaUrl, {
                        headers: { 'Accept': 'text/html' },
                        signal: jinaController.signal
                    });
                    clearTimeout(jinaTimeout);
                    if (jinaRes.ok) {
                        const text = await jinaRes.text();
                        if (text && text.length > 500) {
                            msHtml = text;
                            msMethod = 'jina';
                            console.log(`[MORNINGSTAR DEBUG] ✅ Jina Reader succeeded (${text.length} bytes)`);
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ Jina Reader returned insufficient content`);
                        }
                    } else {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ Jina Reader HTTP ${jinaRes.status}`);
                        await discardResponseBody(jinaRes);
                    }
                } catch (e) {
                    console.log(`[MORNINGSTAR DEBUG] ⚠️ Jina Reader error: ${e.message}`);
                }
            }

            // Method 5: OpenCLI (browser-based, last resort)
            if (!msHtml) {
                try {
                    console.log(`[MORNINGSTAR DEBUG] Method 5: OpenCLI web read...`);
                    const { stdout: cliOutput } = await backgroundPublisherCommand(feed.url, execFileAsync, path.resolve('./node_modules/.bin/opencli'), [
                        'web', 'read', '--url', feed.url,
                        '--stdout', 'true',
                        '--download-images', 'false',
                        '--wait', '5',
                        '--window', 'background'
                    ], {
                        timeout: 30000,
                        maxBuffer: 12 * 1024 * 1024
                    });
                    if (cliOutput && cliOutput.length > 500) {
                        msHtml = cliOutput;
                        msMethod = 'opencli';
                        console.log(`[MORNINGSTAR DEBUG] ✅ OpenCLI succeeded (${cliOutput.length} bytes)`);
                    } else {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ OpenCLI returned insufficient content`);
                    }
                } catch (e) {
                    console.log(`[MORNINGSTAR DEBUG] ⚠️ OpenCLI error: ${e.message}`);
                }
            }

            if (msHtml) {
                console.log(`[MORNINGSTAR DEBUG] 🎯 Using content from method: ${msMethod}`);
                response = new Response(msHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
            } else {
                console.error(`[MORNINGSTAR DEBUG] 🔴 ALL 5 fetch methods failed for ${feed.url}`);
                syncLogs.push({ Feed: feed.title || feed.url, Issue: 'All fetch methods failed (direct, CF proxy, Vietserver, Jina, OpenCLI)' });
                recordFetch(feed.url, feed.title || feed.url, 'error', 'All 5 fetch methods failed', Date.now() - feedFetchStart, { errorType: 'all-methods-failed' });
                return {failed: true};
            }
        } else if (feed.url.includes('techcombank.com')) {
            // Techcombank loads data via GraphQL
            const apiUrl = 'https://techcombank.com/graphql/execute.json/techcombank/viewDocumentList%3BcfPath%3D/content/dam/techcombank/master-data/en/list-view-document/macroeconomics-en/';
            response = await fetch(apiUrl, { headers: BROWSER_HEADERS });
        } else if (feed.url.includes('uobgroup.com')) {
            const apiUrl = 'https://www.uobgroup.com/assets/web-resources/research/csv/archive/todays-focus/csv/macro-note.csv';
            response = await fetch(apiUrl, { headers: BROWSER_HEADERS });
        } else if (feed.url.includes('uob.com.vn')) {
            response = await fetch(feed.url, { headers: BROWSER_HEADERS });
        } else {
            response = await fetchFeedResponse(feed.url);
        }
        return {response, feedData};
    }
    return (feed, options) => withPublisherFetchKind('rss', async () => {
        const manualRecovery = await createManualPublisherRefresh(feed, options.manualRefreshScopes, sourceCooldown);
        const task = () => acquire(feed, options);
        const acquireAll = () => runPublisherFallbacks(feed.url, task, {kind: 'rss', accepted: () => false});
        const result = await (manualRecovery ? manualRecovery.run(acquireAll) : acquireAll());
        return {...result, manualRecovery};
    });
}

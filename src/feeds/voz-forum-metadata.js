import {rssSourceCooldown as sourceCooldown} from '../articles/source-cooldown.js';
import {readPublisherResponse} from '../articles/publisher-verification.js';
import {discardResponseBody} from '../fetch-response.js';
import {extractVozThreadListMetadata} from './voz-thread-metadata.js';

export function createVozForumMetadataScraper({CF_PROXY_BASE, BROWSER_HEADERS,
    fetchFn = (...args) => globalThis.fetch(...args), cooldown = sourceCooldown} = {}) {
    return async function scrapeVozViews(forumUrl) {
        const threads = new Map();
        async function scrapePage(url) {
            try {
                return await cooldown.run(url, async () => {
                    let response;
                    try {
                        response = await fetchFn(CF_PROXY_BASE + encodeURIComponent(url), {
                            headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000)
                        });
                        const html = await readPublisherResponse(response);
                        if (!response.ok) return false;
                        for (const [id, metadata] of extractVozThreadListMetadata(html)) threads.set(id, metadata);
                        return true;
                    } catch (error) {
                        // Optional view counts must not pause successfully fetched RSS.
                        // A metadata rate limit must not disable the RSS chain either.
                        if (error.status === 429 || error.retryAfterMs > 0) throw error;
                        console.error(`[VOZ SCRAPER ERROR] Failed to scrape ${url}: ${error.message}`);
                        return false;
                    } finally {
                        if (response) await discardResponseBody(response);
                    }
                }, {lane: 'p3', recordVerification: false});
            } catch (error) {
                console.error(`[VOZ SCRAPER ERROR] Failed to scrape ${url}: ${error.message}`);
                return false;
            }
        }
        const available = await scrapePage(forumUrl);
        if (available && threads.size < 15) {
            await scrapePage(forumUrl.endsWith('/') ? forumUrl + '?page=2' : forumUrl + '&page=2');
        }
        return threads;
    };
}

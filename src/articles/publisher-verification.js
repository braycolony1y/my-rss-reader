// Shared by HTTP readers and the browser reader child process.
export function isPublisherVerification(value) {
    if (value?.code === 'PUBLISHER_VERIFICATION') return true;
    const text = typeof value === 'string' ? value
        : `${value?.message || ''}\n${value?.title || ''}\n${value?.contentHtml || value?.content || ''}`;
    const sample = text.slice(0, 120000);
    // Feed entries may legitimately quote a CAPTCHA message in a headline.
    if (/^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed|rdf:RDF)\b/i.test(sample)) return false;
    if (/navigation did not become usable:\s*(?:just a moment|security verification|attention required|verify (?:that )?you are)/i.test(sample)) return true;
    return /cf-chl-|enable javascript and cookies|checking your browser|verifying (?:the device|you are human)|requested content will be available after verification|verify (?:that )?you are (?:a )?human|are you a robot|captcha-delivery\.com|please (?:complete|solve) the captcha|press\s*(?:&amp;|&|and)\s*hold.*human|remained behind verification|publisher (?:verification|challenge)|device-verification page|HTTP\s+(?:403|429)\b/i.test(sample)
        || /(?:<title[^>]*>|<h[12][^>]*>|^|\n)\s*(?:security verification|just a moment|attention required)[.!…]*\s*(?:<|$|\n)/i.test(sample)
        || /security verification/i.test(sample.slice(0, 4000)) && /CG\d+\s*\/\s*403|help\.ft\.com/i.test(sample.slice(0, 4000));
}

export function publisherVerificationError({ status, retryAfterMs = 0 } = {}) {
    return Object.assign(new Error(`Publisher security verification required${status ? ` (HTTP ${status})` : ''}. Complete verification in the reader's Chrome window or open the original article, then retry.`), {
        code: 'PUBLISHER_VERIFICATION', status, retryAfterMs
    });
}

export function assertNoPublisherVerification(value) {
    if (isPublisherVerification(value)) throw publisherVerificationError();
    return value;
}

export function isPublisherHttpChallenge(status, html = '') {
    return [401, 403, 429].includes(status) || isPublisherVerification(html);
}

export async function readPublisherResponse(response) {
    const body = await response.text();
    if ([403, 429].includes(response.status) || isPublisherVerification(body)) {
        const retry = response.headers?.get('retry-after');
        const retryAfterMs = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
        throw publisherVerificationError({ status: response.status, retryAfterMs });
    }
    return body;
}

export function isVerificationPage(data) {
    if (!data || typeof data !== 'object' || !('contentHtml' in data)) return false;
    const frames = data.diagnostics?.frames || [];
    return (String(data.contentHtml).replace(/<[^>]*>/g, '').length < 1500
        && frames.some(frame => /captcha-delivery\.com|challenges\.cloudflare\.com/i.test(frame.src || '')))
        || isPublisherVerification(data);
}

export async function readWithHumanVerification(read, page, kwargs, canWait) {
    const guardedPage = new Proxy(page, {
        get(target, key) {
            if (key !== 'evaluate') {
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return async (...args) => {
                let data = await target.evaluate(...args);
                while (isVerificationPage(data)) {
                    if (!await canWait()) throw Object.assign(publisherVerificationError(), { message: 'Publisher verification blocked this fetch.' });
                    await target.wait(1);
                    data = await target.evaluate(...args);
                }
                return data;
            };
        }
    });
    return read(guardedPage, kwargs, false);
}

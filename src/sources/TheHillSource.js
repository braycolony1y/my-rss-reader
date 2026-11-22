import { decodeHTML } from 'entities';

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function theHillOpenCliUrl(value = '') {
    try {
        const url = new URL(value);
        if (url.hostname.replace(/^www\./, '') !== 'thehill.com') return value;
        if (!/^\/(?:[^/]+\/)+\d{5,}-[^/]+\/?$/i.test(url.pathname) || /\/amp\/?$/i.test(url.pathname)) {
            return url.href;
        }
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/amp/`;
        url.hash = '';
        return url.href;
    } catch (error) {
        return value;
    }
}

export default class TheHillSource {
    match(hostname) {
        return hostname === 'thehill.com' || hostname.endsWith('.thehill.com');
    }

    getOpenCliReaderUrl(url) {
        return theHillOpenCliUrl(url);
    }

    parseOpenCliMarkdown(markdown) {
        return {
            markdown: String(markdown || '').replace(/\n{3,}/g, '\n\n').trim(),
            readerType: 'the-hill-amp-article'
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350
            && !/(?:press\s*(?:&|and)\s*hold\s+to confirm you are a human|access (?:to this page )?has been denied|before we continue.{0,160}(?:human|bot))/i.test(text);
    }
}

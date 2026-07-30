import { generateVozThreadSummary } from './summary-engine.js';
import fetch from 'node-fetch';

async function test() {
    const fetchPage = async (pageUrl) => {
        const proxyUrl = "https://rss-proxy.k1d.workers.dev/?url=" + encodeURIComponent(pageUrl);
        const fetchRes = await fetch(proxyUrl);
        if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status} from proxy`);
        const content = await fetchRes.text();
        // Print first 500 characters to see if it's a redirect or XenForo page
        console.log("HTML START:", content.slice(0, 500));
        return { content };
    };

    try {
        const url = "https://voz.vn/t/cac-loi-khuyen-cua-cac-hr-va-sep-cu-da-nhau-the-nao-y-domain-vs-da-nang.1265202/unread";
        const summary = await generateVozThreadSummary(
            url, 
            fetchPage, 
            (progress) => console.log('PROGRESS:', progress)
        );
        console.log('SUMMARY:', summary);
    } catch (e) {
        console.error('ERROR:', e);
    }
}
test();

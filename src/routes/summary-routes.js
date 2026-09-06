import { authMiddleware } from '../middleware/auth.js';
import { getSummaryFromCache, summaryQueue, generateVozThreadSummary, writeSummaryToCache, generateDeepAnalysis, geminiKeyManager } from '../../summary-engine.js';

export function registerSummaryRoutes({
    app,
    decodeGoogleNews,
    BROWSER_HEADERS,
    fetchViaVietserver,
    env,
} = {}) {
    // AI Summary Routes
    app.get('/api/summary', authMiddleware, async (req, res) => {
        let url = req.query.url;
        if (!url) return res.status(400).json({ error: 'URL required' });


        url = await decodeGoogleNews(url);

        try {
            const summary = await getSummaryFromCache(url);
            if (summary && summary.status === 'ready') {
                return res.json(summary);
            }
            if (summary && summary.status === 'generating') {
                const jobStatus = summaryQueue.getJobStatus(url);
                return res.json(jobStatus || { status: 'generating' });
            }
            const isVoz = url.includes('voz.vn');
            if (isVoz) return res.json({ status: 'voz_manual' });

            const jobStatus = summaryQueue.getJobStatus(url);
            if (jobStatus) {
                return res.json(jobStatus);
            }
            return res.json({ status: 'manual' });
        } catch (e) {
            console.error('[SUMMARY] Failed to fetch summary:', e);
            res.status(500).json({ error: 'Failed to fetch summary' });
        }
    });

    app.post('/api/summary/prioritize', authMiddleware, async (req, res) => {
        let url = req.body?.url;
        if (!url) return res.status(400).json({ error: 'URL required' });


        url = await decodeGoogleNews(url);

        summaryQueue.prioritize(url);
        res.json({ ok: true });
    });

    const vozJobs = new Map();

    app.post('/api/summary/voz', authMiddleware, async (req, res) => {
        let url = req.body?.url;
        let mode = req.body?.mode || 'detailed';
        if (!url) return res.status(400).json({ error: 'URL required' });

        if (vozJobs.has(url)) {
            return res.json({ ok: true, message: 'Already running' });
        }

        const controller = new AbortController();
        const job = { url, mode, progress: { stage: 'starting', current: 0, total: null, message: 'Starting...' }, summary: null, error: null, controller };
        vozJobs.set(url, job);

        res.json({ ok: true });

        // Run in background
        (async () => {
            const fetchPage = async (pageUrl) => {
                const proxyUrl = "https://rss-proxy.k1d.workers.dev/?url=" + encodeURIComponent(pageUrl);
                let fetchRes = await fetch(proxyUrl, {
                    headers: { ...BROWSER_HEADERS, 'Connection': 'close' },
                    signal: controller.signal
                }).catch(e => ({ ok: false }));

                let content = '';
                if (fetchRes.ok) {
                    content = await fetchRes.text();
                }

                if (!fetchRes.ok || content.includes('<title>Just a moment...</title>') || content.includes('Cloudflare')) {
                    console.log(`[VOZ SUMMARY] CF Proxy failed/blocked for ${pageUrl}. Falling back to Vietserver proxy...`);
                    content = await fetchViaVietserver(pageUrl);
                }

                let pagination = null;
                if (content) {
                    const nextMatch = content.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*pageNav-jump--next[^"']*["']/i);
                    const nextUrl = nextMatch ? "https://voz.vn" + nextMatch[1].replace(/^https:\/\/voz\.vn/, '') : null;

                    const allPages = [...content.matchAll(/href=["'][^"']+page-(\d+)["']/gi)].map(m => parseInt(m[1]));
                    const totalPages = allPages.length > 0 ? Math.max(1, ...allPages) : 1;

                    if (totalPages > 1 || nextUrl) {
                        pagination = { totalPages, nextUrl };
                    }
                }

                return { content, pagination };
            };

            try {
                const summary = await generateVozThreadSummary(
                    url,
                    fetchPage,
                    (progress) => { job.progress = progress; },
                    controller.signal,
                    { fastMode: mode === 'fast' }
                );

                job.summary = summary;

                let articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
                let updated = false;
                for (let i = 0; i < articles.length; i++) {
                    if (articles[i].link === url || articles[i].url === url || (articles[i].link && articles[i].link.split('?')[0].replace(/\/unread\/?$/, '') === url.split('?')[0].replace(/\/unread\/?$/, ''))) {
                        articles[i].vozSummary = summary;
                        updated = true;
                    }
                }
                if (updated) {
                    await env.RSS_DATA.put('articles', JSON.stringify(articles));
                }
            } catch (e) {
                if (e.name !== 'AbortError' && e.message !== 'Cancelled') {
                    job.error = e.message;
                    console.error('[VOZ SUMMARY] Error:', e);
                }
            }
        })();
    });

    app.get('/api/summary/voz/status', authMiddleware, (req, res) => {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: 'URL required' });
        const job = vozJobs.get(url);
        if (!job) return res.json({ status: 'not_found' });

        if (job.summary) {
            vozJobs.delete(url);
            return res.json({ status: 'ready', summary: job.summary });
        }
        if (job.error) {
            vozJobs.delete(url);
            return res.json({ status: 'error', error: job.error });
        }
        return res.json({ status: 'generating', progress: job.progress });
    });

    app.post('/api/summary/voz/cancel', authMiddleware, (req, res) => {
        const url = req.body.url;
        if (!url) return res.status(400).json({ error: 'URL required' });
        const job = vozJobs.get(url);
        if (job) {
            job.controller.abort();
            vozJobs.delete(url);
        }
        res.json({ ok: true });
    });

    app.post('/api/summary/feedback', authMiddleware, async (req, res) => {
        let { url, feedback } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });


        url = await decodeGoogleNews(url);

        try {
            const summary = await getSummaryFromCache(url);
            if (summary) {
                summary.feedback = feedback;
                await writeSummaryToCache(url, summary);
                return res.json({ ok: true });
            }
            res.status(404).json({ error: 'Summary not found' });
        } catch (e) {
            res.status(500).json({ error: 'Failed to update feedback' });
        }
    });

    app.post('/api/summary/analysis', authMiddleware, async (req, res) => {
        let url = req.body?.url;
        if (!url) return res.status(400).json({ error: 'URL required' });


        url = await decodeGoogleNews(url);

        try {
            const result = await generateDeepAnalysis(url);
            res.json({ success: true, analysis: result.text, analysisModel: result.model });
        } catch (e) {
            console.error('[SUMMARY] Failed to generate deep analysis:', e);
            res.status(500).json({ error: e.message || 'Failed to generate deep analysis' });
        }
    });

    app.get('/api/summary/debug', authMiddleware, (req, res) => {
        const geminiStats = geminiKeyManager.getDebugStats();
        res.json({
            queue: summaryQueue.getStatus(),
            gemini: geminiStats
        });
    });

}

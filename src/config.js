import dotenv from 'dotenv';
import { promisify } from 'util';
import { execFile } from 'child_process';

export function loadConfiguration() {
    dotenv.config();

    // Keep the Gemini credential separate from the rest of the application config.
    // Values here intentionally override matching entries in the general .env file.
    dotenv.config({ path: './gemini.env', override: true });

    // Optional Vietserver Proxy Base URL (e.g., https://proxy.yourdomain.com/?url=)
    const VIETSERVER_PROXY_BASE = process.env.VIETSERVER_PROXY_BASE || '';

    const JINA_READER_BASE = 'https://r.jina.ai/';

    const execFileAsync = promisify(execFile);

    const PORT = process.env.PORT || 3000;

    const VALID_CLUSTERING_MODELS = new Set([
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash'
    ]);

    const configuredClusteringModel = process.env.SMART_CLUSTERING_MODEL || 'gemini-3.5-flash-lite';

    const DEFAULT_CLUSTERING_MODEL = VALID_CLUSTERING_MODELS.has(configuredClusteringModel)
        ? configuredClusteringModel
        : 'gemini-3.5-flash-lite';

    const normalizeClusteringModel = model => VALID_CLUSTERING_MODELS.has(model)
        ? model
        : DEFAULT_CLUSTERING_MODEL;

    const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';

    // --- BROWSER DISGUISE HEADERS ---
    const BROWSER_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
    };

    return {
        execFileAsync,
        VIETSERVER_PROXY_BASE,
        JINA_READER_BASE,
        BROWSER_HEADERS,
        CF_PROXY_BASE,
        normalizeClusteringModel,
        VALID_CLUSTERING_MODELS,
        PORT
    };
}

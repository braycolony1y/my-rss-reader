import { qwenKeyManager, getSummaryFromCache, writeSummaryToCache } from './summary-engine.js';
import { generateVozThreadSummary } from './summary-engine.js';
import { summaryQueue } from './summary-engine.js';

// Wait for keys to load
setTimeout(async () => {
    console.log("Qwen keys:", qwenKeyManager.keys);
    summaryQueue.enqueue("https://example.com/test-article", { title: "Test Article" }, 0);
    summaryQueue.start();
    
    // Write fake cache for the article so it can be summarized
    const fs = await import('fs/promises');
    const crypto = await import('crypto');
    const canonicalUrl = "https://example.com/test-article";
    const hash = crypto.createHash('sha256').update(canonicalUrl).digest('hex');
    await fs.writeFile(`./article_cache/${hash}.json`, JSON.stringify({
        result: {
            content: "<p>This is a test article to verify the Qwen fallback system. It should try Qwen first, fail because the key is obfuscated, and then fallback to Gemini. The text must be long enough to be summarized, so I am writing a bunch of words here to make sure it passes the 80 character length check. Hopefully this is long enough.</p>",
            title: "Test Article",
            siteName: "Example"
        }
    }));
}, 1000);

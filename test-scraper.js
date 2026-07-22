import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';
const TARGET_URL = 'https://global.morningstar.com/en-gb/etfs';
const PROXIED_URL = CF_PROXY_BASE + encodeURIComponent(TARGET_URL);

async function testProxyBypass() {
    console.log('🚀 Launching stealth browser...');

    const browser = await puppeteerExtra.launch({
        headless: false,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--no-sandbox',
            '--window-size=1280,720'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    console.log(`🌐 Navigating via YOUR proxy: \n${PROXIED_URL}`);

    try {
        // Go to the Cloudflare Worker URL instead of Morningstar directly
        await page.goto(PROXIED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log('⏳ Waiting 8 seconds for JS challenge to attempt execution...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        const html = await page.content();

        if (html.includes('window.__NUXT__')) {
            console.log('✅ SUCCESS! The proxy + Puppeteer combo worked.');
        } else if (html.includes('challenge-container')) {
            console.log('❌ FAILED: Stuck on the WAF challenge page.');
            console.log('⚠️ Why? AWS WAF challenges are domain-locked. The script expects to run on "morningstar.com", but it is running on "k1d.workers.dev". It likely failed to set the auth cookies.');
        } else {
            console.log('⚠️ UNKNOWN STATE. HTML Length:', html.length);
        }

    } catch (err) {
        console.error('🔴 Error:', err.message);
    }

    // Leaving browser open for your inspection
    console.log('\n🛑 I AM LEAVING THE BROWSER OPEN. Inspect the console (Cmd+Option+J) for CORS or Cookie errors.');
}

testProxyBypass();
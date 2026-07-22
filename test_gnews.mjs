async function decodeGoogleNewsArticleUrl(sourceUrl) {
    const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
    const articlePageUrl = sourceUrl.replace('/rss/articles/', '/articles/');
    const pageResponse = await fetch(articlePageUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
    if (!pageResponse.ok) throw new Error('Google News wrapper returned HTTP ' + pageResponse.status);
    const pageHtml = await pageResponse.text();
    const attribute = name => {
        const match = pageHtml.match(new RegExp('\\s' + name + '=(?:"([^"]+)"|\'([^\']+)\')', 'i'));
        return match ? (match[1] || match[2]) : '';
    };
    const articleId = attribute('data-n-a-id') || sourceUrl.match(/\/(?:rss\/)?articles\/([^?]+)/)?.[1] || '';
    const timestamp = attribute('data-n-a-ts');
    const signature = attribute('data-n-a-sg');
    if (!articleId || !timestamp || !signature) {
        console.error('Missing metadata:', { articleId, timestamp, signature });
        throw new Error('Google News destination metadata was unavailable');
    }

    const context = [
        ['en-US', 'US', ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'US:en', null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
        'en-US', 'US', 1, [2, 3, 4, 8], 1, 0, '655000234', 0, 0, null, 0
    ];
    const innerRequest = JSON.stringify(['garturlreq', context, articleId, Number(timestamp), signature]);
    const form = new URLSearchParams({
        'f.req': JSON.stringify([[['Fbv4je', innerRequest, null, 'generic']]])
    });
    const rpcResponse = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: {
            ...BROWSER_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: form
    });
    if (!rpcResponse.ok) throw new Error('Google News destination lookup returned HTTP ' + rpcResponse.status);
    const rpcText = await rpcResponse.text();
    console.log('RPC TEXT:', rpcText);
    return 'done';
}

decodeGoogleNewsArticleUrl('https://news.google.com/rss/articles/CBMijAFBVV95cUxOZVZMSTI4a0djLVNwM2pqWUQyaFZKaDExVWsxaHUyN0p4NjhZMnY2UGpfTkpmR1Y2QjNtMndxMTgtWlVBTlBqTXRWSzBvMEVIVmlWd1lVVzNPcDc0ME9SUDZaTFlRTGRSMC1TUDEyelRKR0VrWEx2eXFHQ1p1Yjlfb09UQjkwZHMzMlJzRA?oc=5').catch(console.error);

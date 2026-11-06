const EMBED_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'tiktok.com', 'player.bilibili.com', 'dailymotion.com', 'facebook.com', 'instagram.com', 'platform.twitter.com', 'redditmedia.com', 'reddit.com'];
const YOUTUBE_HOSTS = ['youtube.com', 'youtube-nocookie.com'];
const BASE_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';
const matchesHost = (hostname, hosts) => hosts.some(host => hostname === host || hostname.endsWith('.' + host));

export function postIframePolicy(src) {
    try {
        const url = new URL(src);
        if (url.protocol !== 'https:' || !matchesHost(url.hostname, EMBED_HOSTS)) return null;
        const isYoutube = matchesHost(url.hostname, YOUTUBE_HOSTS);
        // Native YouTube links open a full watch page in a new tab. That page
        // must not inherit the embedded player's restrictions (e.g. on forms).
        return {
            isYoutube,
            sandbox: BASE_SANDBOX + (isYoutube ? ' allow-popups-to-escape-sandbox' : '')
        };
    } catch { return null; }
}

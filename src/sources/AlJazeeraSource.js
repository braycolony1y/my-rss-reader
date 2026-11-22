import * as cheerio from 'cheerio/slim';

export default class AlJazeeraSource {
    match(host) { return host === 'aljazeera.com' || host === 'www.aljazeera.com'; }
    parseArticleHtmlContent(html, url, result) {
        if (!new URL(url).pathname.startsWith('/video/')) return false;
        const $ = cheerio.load(html);
        let video;
        const visit = node => {
            if (!node || typeof node !== 'object') return;
            if (node['@type'] === 'VideoObject' && node.embedUrl) video = node;
            for (const value of Object.values(node)) if (typeof value === 'object') visit(value);
        };
        $('script[type="application/ld+json"]').each((_, el) => { try { visit(JSON.parse($(el).text())); } catch {} });
        if (!video) return false;
        let embed;
        try { embed = new URL(video.embedUrl); } catch { return false; }
        if (embed.protocol !== 'https:' || embed.hostname !== 'players.brightcove.net') return false;
        const root = $('<div></div>');
        root.append($('<iframe></iframe>').attr({ src: embed.href, title: video.name || 'Al Jazeera video', allow: 'fullscreen; encrypted-media; picture-in-picture', allowfullscreen: '', style: 'width:100%;aspect-ratio:16/9;border:0' }));
        root.append($('<p></p>').text($('.article__subhead').first().text().trim() || video.description || ''));
        result.title = video.name || result.title;
        result.date = video.uploadDate || result.date;
        result.image = video.thumbnailUrl || result.image;
        return root.html();
    }
}

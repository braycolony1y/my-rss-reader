import { load } from 'cheerio';
import { storyText, publisherId } from './story-ranking.js';

const stopWords = new Set(`the a an and or of to in on at for with from by as is are was were has have this that today latest news update updates live morning evening daily weekly briefing roundup digest newsletter podcast tin bản bản-tin những các của và về tại trong với cho một được đã đang sẽ là có theo mới ngày sáng chiều tối thế giới điểm nóng sau đây nội dung`.split(/\s+/));
export function eventTokens(text) {
    return new Set(storyText(text).toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 1 && !stopWords.has(word) && !/^\d+$/.test(word)) || []);
}
export function eventMatch(left, right) {
    const a = eventTokens(left), b = eventTokens(right);
    const shared = [...a].filter(word => b.has(word)).length;
    return { shared, similarity: shared / Math.max(1, Math.max(a.size, b.size)) };
}
const explicitTitle = /\b(?:(?:news|headlines?)\s+(?:round[- ]?up|digest)|(?:daily|weekly|morning|evening)\s+(?:news|digest|round[- ]?up|briefing|headlines?)|top\s+(?:stories|headlines)\s+(?:today|this\s+(?:morning|evening|week))|news\s+(?:in\s+brief|briefs)|multi[- ]topic\s+(?:live|digest))\b|(?:bản tin|tin nóng|điểm tin|điểm báo|tin vắn|tổng hợp tin|những tin chính).*(?:thế giới|trong nước|sáng|chiều|tối|hôm nay|ngày|tuần)|tin tức.*(?:trong ngày|hôm nay)/iu;
const intro = /(?:these|today'?s|this (?:morning|evening)'?s)\s+(?:are\s+)?(?:the\s+)?(?:top\s+)?headlines|(?:roundup|digest)\s+of\s+(?:today'?s|the latest)\s+(?:news|stories)|(?:có|gồm|bao gồm)\s+(?:những\s+)?(?:nội dung|tin chính|tin tức|thông tin)\s+(?:chính\s+)?sau/iu;
const formatTitle = /\b(?:newsletter|podcast|digest|roundup|briefing|live blog|live updates)\b|bản tin|điểm tin|điểm báo/iu;
const eventVerb = /\b(?:announces?|approves?|rejects?|confirms?|launches?|strikes?|signs?|blocks?|discovers?|cuts?|raises?|agrees?|kills?|warns?|reports?)\b|công bố|thông qua|bác|xác nhận|tấn công|thỏa thuận|phát hiện|chặn|ban hành|cảnh báo|thiệt mạng/iu;

// Boundaries come from source formatting. Never split one digest bullet into
// invented standalone articles; uncertain boundaries simply yield no support.
export function roundupItems(article) {
    const html = String(article.content || article.description || article.summary || '');
    const $ = load(html);
    $('nav, footer, aside, script, style, .related, .related-news').remove();
    const items = [];
    const add = (title, text, links = []) => {
        text = storyText(text);
        if (text) items.push({ title: storyText(title) || text, text, links });
    };
    const linksIn = node => $(node).find('a[href]').toArray().map(a => {
        try { const url = new URL($(a).attr('href'), article.link); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
    }).filter(Boolean);
    const headings = $('h2,h3').toArray();
    if (headings.length > 1) {
        for (const heading of headings) {
            const body = $(heading).nextUntil('h2,h3');
            add($(heading).text(), `${$(heading).text()} ${body.text()}`, [...linksIn(heading), ...body.toArray().flatMap(linksIn)]);
        }
    } else if ($('li').length > 1) {
        for (const li of $('li').toArray()) add($(li).text(), $(li).text(), linksIn(li));
    } else {
        const blocks = html.replace(/<(?:br\s*\/?|\/p|\/div)>/gi, '\n').replace(/<[^>]*>/g, ' ');
        const bullets = blocks.split(/(?:^|\n)\s*(?:[-•*]|\d+[.)])\s+|;\s*[-•]\s+|\s+-\s+/u);
        if (bullets.length > 2) {
            for (const bullet of bullets.slice(1)) {
                // RSS frequently appends unrelated recommendation headlines after
                // the final sentence. Only the bounded headline sentence is used.
                const text = storyText(bullet).split(/(?<=[.!?])\s+/u)[0].replace(/;$/, '');
                add(text, text);
            }
        }
    }
    return [...new Map(items.map(item => [item.text, item])).values()];
}
export function detectRoundup(article) {
    const title = storyText(article.title);
    const text = storyText(article.content || article.description || article.summary);
    const strong = explicitTitle.test(title) || intro.test(text);
    const structured = /<(?:h[23]|li)\b|(?:^|\n)\s*[-•*]\s|;\s*[-•]\s/u.test(String(article.content || article.description || ''));
    if (!strong && !formatTitle.test(title) && !structured) return { isRoundup: false, reason: null, items: [] };
    const items = roundupItems(article);
    const developments = items.filter(item => eventVerb.test(item.title));
    const distinct = [];
    for (const item of developments) if (distinct.every(other => eventMatch(item.title, other.title).similarity < .2)) distinct.push(item);
    const multiEvent = distinct.length >= 3 || (formatTitle.test(title) && distinct.length >= 2);
    return { isRoundup: strong || multiEvent, reason: strong ? 'Explicit multi-headline bulletin/digest' : multiEvent ? 'Separately headed unrelated developments' : null, items: strong || multiEvent ? items : [] };
}

export function splitContainerMembers(members, matchSettings) {
    const groups = [];
    for (const member of members) {
        const group = groups.find(group => group.some(other => {
            const match = eventMatch(member.title, other.title);
            return member.link === other.link || storyText(member.title) === storyText(other.title) || (match.shared >= matchSettings.roundupMinSharedTokens && match.similarity >= matchSettings.roundupMatchSimilarity);
        }));
        if (group) group.push(member); else groups.push([member]);
    }
    return groups;
}

// Attach to an existing event only. The roundup never participates in unioning
// events, representative selection, ranking, freshness or factual confirmation.
export function attachRoundupCoverage(stories, containers, allowed, settings) {
    const index = new Map(), byLink = new Map();
    for (const story of stories.filter(s => !s.topStory.isRoundup)) {
        for (const article of [story, ...(story.relatedArticles || [])]) {
            byLink.set(article.link, story);
            for (const token of eventTokens(article.title)) {
                if (!index.has(token)) index.set(token, new Set());
                index.get(token).add(story);
            }
        }
    }
    for (const container of containers) {
        const destinations = allowed(container);
        for (const item of container.roundup.items) {
            const direct = [...new Set(item.links.map(link => byLink.get(link)).filter(Boolean))];
            const pool = direct.length ? direct : [...new Set([...eventTokens(item.title)].flatMap(token => [...(index.get(token) || [])]))];
            const matches = pool.filter(story => destinations.includes(story.topStory.feed)).map(story => {
                const best = [story, ...(story.relatedArticles || [])].filter(a => !a.roundupSupport).map(a => eventMatch(item.title, a.title)).sort((a,b) => b.similarity-a.similarity)[0];
                return { story, ...best, direct: direct.includes(story) };
            }).filter(m => m.direct || (m.shared >= settings.roundupMinSharedTokens && m.similarity >= settings.roundupMatchSimilarity)).sort((a,b) => Number(b.direct)-Number(a.direct) || b.similarity-a.similarity);
            // Ambiguous items cannot connect two events or pollute their briefings.
            if (!matches.length || (matches[1] && (matches[0].direct === matches[1].direct) && matches[0].similarity - matches[1].similarity < settings.roundupMatchMargin)) continue;
            const { story, similarity, direct: linked } = matches[0];
            if (story.relatedArticles.some(a => a.link === container.link)) continue;
            const support = { ...container, relatedArticles: undefined, content:item.text, description:undefined, summary:undefined,
                roundupSupport: { text:item.text, eventTitle:item.title, matchedCluster:story.clusterId, similarity, reason:linked ? 'Direct event article link' : 'Strong event headline match' } };
            story.relatedArticles.push(support);
            story.clusterCount = story.relatedArticles.length + 1;
            story.sourceCount = new Set([story, ...story.relatedArticles].map(publisherId)).size;
            story.topStory.supportingRoundups ||= [];
            story.topStory.supportingRoundups.push({link:container.link, ...support.roundupSupport});
        }
    }
}

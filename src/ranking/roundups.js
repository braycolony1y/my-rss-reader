import { storyText } from '../articles/story-ranking.js';

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
const formatTitle = /\b(?:newsletter|podcast|digest|roundup|briefing|live blog|live updates)\b|bản tin|điểm tin|điểm báo/iu;
// Title-only digest test shared with the deterministic ranker (no HTML parsing).
export const isRoundupTitle = title => { const text = storyText(title); return explicitTitle.test(text) || formatTitle.test(text); };

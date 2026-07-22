import fs from 'fs';

function trimArticleMarkupAtSemanticBoundary(markup) {
    const source = String(markup || '');
    const boundaryPattern = /<(?:p|h[1-6]|div|section|ul|li)\b[^>]*>[\s\S]{0,350}?(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Đừng bỏ lỡ|Advertisements|(?:Trở lại|Quay lại)\s+(?:trang chủ|chuyên mục|Trang chủ|Chuyên mục)|(?:Bình luận|Comments)\s*\(\s*\d+\s*\)|Tin liên quan|Related stories|You may also like|Recommended for you|More stories|Read next|Tuổi Trẻ Online Newsletters|Thêm\s+[^\n<]{1,80}\s+trên Google|Chọn\s+[^\n<]{1,80}\s+làm nguồn ưu tiên|Chủ đề liên quan|Xem thêm:|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|Link bài gốc)[\s\S]{0,350}?<\/(?:p|h[1-6]|div|section|ul|li)>/giu;
    
    let match;
    const candidates = [];
    while ((match = boundaryPattern.exec(source)) !== null) {
        console.log("Matched text:", match[0].substring(0, 100));
        candidates.push(match.index);
    }
    
    const validCandidates = candidates.filter(index => source.slice(0, index).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().length >= Math.max(250, Math.min(800, Math.floor(source.length * 0.25))));
    
    console.log("Candidates:", candidates);
    if (candidates.length > 0) {
        console.log("Text at first candidate:", source.substring(candidates[0], candidates[0] + 200));
    }
    console.log("Valid candidates:", validCandidates);

    if (validCandidates.length) {
        return source.slice(0, Math.min(...validCandidates));
    }
    
    const rawPattern = /(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Tuổi Trẻ Online Newsletters|\bTin liên quan\b|\bChủ đề liên quan\b|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|\bXem thêm:\b|\bBài liên quan\b|Link bài gốc)(?:\s*(?:<[^>]+>|\s|[\p{L}\d\-,.!"'?:();/]){1,1000})?$/iu;
    const rawMatch = rawPattern.exec(source);
    if (rawMatch && rawMatch.index > 250) {
        console.log("Raw match at", rawMatch.index);
        console.log("Text at raw match:", source.substring(rawMatch.index, rawMatch.index + 100));
        return source.slice(0, rawMatch.index);
    }

    return source;
}

const file = fs.readFileSync('article_cache/37be4c4e172c542d78bb7761852041b8650dbdfc96c00299c9a7228a8c3f6925.json', 'utf-8');
const data = JSON.parse(file);
const res = trimArticleMarkupAtSemanticBoundary(data.result.content);
console.log("End of trimmed text:", res.substring(res.length - 200));

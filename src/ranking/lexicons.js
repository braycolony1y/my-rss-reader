// Lexicons for the deterministic story ranker (English + Vietnamese). Pure data, no I/O.
//
// These regexes are the ones the ranker's weights were fitted against, so changing
// one changes the meaning of its weight in model.json. Edit with care and re-run the
// replay (see src/ranking/README.md) before shipping.
import { MATERIALITY_GUARDS } from '../smart/prefilter/policy.js';

const L = '\\p{L}\\p{N}';
/** Whole-word alternation that is Unicode-aware (JS \b is ASCII only). */
const W = words => new RegExp(`(?<![${L}])(?:${words})(?![${L}])`, 'iu');

/** Title/lead lexicons. Keys are feature names in model.json. */
export const LEX = {
  // impact signals copied from src/articles/story-ranking.js (rankStory)
  rs_geo: /\b(invasion|ceasefire|sanctions|presidential election|parliamentary election|earthquake|evacuat\w*|killed|emergency)\b|chiến tranh|ngừng bắn|bầu cử|động đất|thiệt mạng/iu,
  rs_macro: /\b(central bank|interest rate|inflation|tariff|recession|default|bankruptcy|rate cut|rate hike)\b|lãi suất|lạm phát|thuế quan|phá sản/iu,
  rs_tech: /\b(antitrust|data breach|chip export|regulator|security flaw|acquisition|critical vulnerability)\b|rò rỉ dữ liệu|đột phá|độc quyền/iu,
  rs_material: /\b(announces?|approves?|signs?|launches?|raises?|cuts?|strikes?|confirms?)\b|thông qua|công bố|ban hành/iu,
  rs_repeat: /\b(recap|roundup|what we know|explained|opinion|preview)\b|điểm tin|nhìn lại/iu,
  rs_low: /\b(lucky|my default|best deals|coupon|discount|writers have|youtubers|review|unboxing|wallpaper|weekend menu)\b/iu,
  // extended lexicons
  x_conflict: W('war|missile|airstrike|air strike|drone strike|attack(?:s|ed)?|dead|death toll|casualt\\w*|explosion|shooting|hostage|truce|nuclear|troops|military|coup|terror\\w*|tsunami|hurricane|typhoon|flood\\w*|wildfire|crash(?:es|ed)?|massacre|bombing|kills?|wounds?|chiến sự|tấn công|tên lửa|không kích|tử vong|trừng phạt|bão|lũ lụt|sập|khủng bố|hạt nhân|quân sự|xung đột|biển đông|thương vong|nổ'),
  x_macro: W('fed|federal reserve|rate decision|cpi|gdp|treasur(?:y|ies)|yields?|opec|crude|oil prices?|gold|bitcoin|crypto\\w*|selloff|sell-off|plunge[sd]?|surge[sd]?|soar(?:s|ed)?|tumble[sd]?|record high|all-time high|correction|bubble|debt|deficit|jobs report|payrolls|exports?|imports?|vn-?index|lãi suất|tỷ giá|giá vàng|giá xăng|giá dầu|chứng khoán|trái phiếu|nợ xấu|ngân hàng nhà nước|tăng trưởng|xuất khẩu|nhập khẩu|điều hành|vàng|bất động sản'),
  x_politics: W('president|prime minister|parliament|congress|senate|supreme court|court|election|vote[sd]?|bill|resolution|summit|treaty|trump|putin|xi jinping|zelensky|netanyahu|white house|kremlin|nato|\\bun\\b|nghị quyết|quốc hội|thủ tướng|chủ tịch|bộ trưởng|tổng bí thư|bầu cử|nghị định|chính phủ|tòa án|khởi tố|truy tố|tổng thống|hội nghị|thượng đỉnh|đàm phán|ngoại giao'),
  x_corp: W('ipo|acquires?|acquisition|merger|layoffs?|earnings|revenue|profit|antitrust|ransomware|cyberattack|outage|lawsuit|recall|openai|anthropic|nvidia|apple|google|microsoft|meta|tesla|amazon|chip|chips|semiconductor|ai|model|sáp nhập|mua lại|doanh thu|lợi nhuận|rò rỉ|sự cố|bán dẫn|niêm yết|cổ phiếu'),
  x_fluff: W('reviews?|unboxing|best|deals?|discount|coupon|how to|tips|guide|recipe|horoscope|celebrity|gossip|football|premier league|nba|world cup|lifestyle|travel|fashion|beauty|movie|trailer|concert|netflix|series|gaming|streamer|quiz|giải trí|sao việt|showbiz|du lịch|ẩm thực|món ngon|mẹo|cách làm|đánh giá|trên tay|khuyến mãi|bóng đá|tử vi|phim|ca sĩ|hoa hậu|thời trang|làm đẹp|giải mã|tại sao|vì sao|bí quyết|ngày mai|cuối tuần'),
  x_local: W('csgt|xử phạt|tai nạn|va chạm|bắt giữ|nam sinh|nữ sinh|trộm|cướp|lừa đảo|nhà trọ|hàng xóm|clip|video|tiktok|facebook|viral'),
  x_live: W('live|live updates|live blog|trực tiếp'),
  x_opinion: W('opinion|editorial|commentary|analysis|column|góc nhìn|bình luận|quan điểm'),
  x_digest: /\b(?:(?:news|headlines?)\s+(?:round[- ]?up|digest)|(?:daily|weekly|morning|evening)\s+(?:news|digest|round[- ]?up|briefing|headlines?)|top\s+(?:stories|headlines)\s+(?:today|this\s+(?:morning|evening|week))|news\s+(?:in\s+brief|briefs)|newsletter|podcast|digest|roundup|briefing)\b|bản tin|điểm tin|điểm báo|tin vắn|tổng hợp tin|tin nóng|những tin chính/iu,
  x_money: /[$€£¥]|\busd\b|\beur\b|\bvnd\b|\btỷ\b|\btriệu\b|\bbillion\b|\bmillion\b|\btrillion\b|\bđồng\b|\bđô\b/iu,
  x_bigmoney: /\b\d[\d.,]*\s?(?:b|bn|billion|trillion|t|tỷ|nghìn tỷ|ngàn tỷ)\b|\$\s?\d[\d.,]*\s?(?:b|bn|billion|t|trillion)\b|\btrillion\b/iu,
  x_attrib: /\((?:[^)]{2,60}\/)?(?:reuters|bloomberg|ap|afp|cnbc|wsj|ft|financial times|the information|techcrunch|verge|axios|new york times|nyt|wall street journal)\)\s*$/iu,
  x_sources_says: /^(?:sources|source|exclusive|breaking|just in|update|bloomberg|reuters)\b\s*[:\-–]/iu
};

/**
 * Materiality guards (diacritic-free text) shared with the Vietnamese prefilter so the two never drift.
 * Feature names g_* map to policy.js guard names.
 */
export const GUARDS = {
  g_public: MATERIALITY_GUARDS.public_consequence,
  g_struct: MATERIALITY_GUARDS.structural_capacity,
  g_funded: MATERIALITY_GUARDS.binding_or_funded_action,
  g_failure: MATERIALITY_GUARDS.major_failure,
  g_scale: MATERIALITY_GUARDS.meaningful_scale
};

/** Union of the exclusion rules in policy.js (TECH_RULES / NEWS_RULES), as fitted. */
export const POLICY_EXCLUDE = /\b(ranking|innovation index|readiness index|ranked|league table|survey|adoption survey|user poll|aims to|aspires to|could become|conference|exhibition|workshop|showcase|ceremony|awards?|contest|nomination|prize|mou|non.binding|will explore|small pilot|proof of concept|demo|minor research|small grant|digital.skills|training workshop|internal ai|ai assistant|corporate case study|ai agents)\b|\b(xep hang|thang hang|chi so doi moi|khao sat|tham do|phan dau|co the tro thanh|gian hang|trien lam|hoi thao|ngay hoi|khai mac|thang giai|giai thuong|vinh danh|de cu|cuoc thi|bien ban ghi nho|bat tay|hop tac chien luoc|trinh dien|ky nang so|tap huan|tro ly ai|so hoa ho so|so hoa du lieu)\b|\b(?:rises?|moves? up) one place|\ble ky niem thuong nien\b/;

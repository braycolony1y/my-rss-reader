import { normalizeText } from '../text/normalize.js';

export const FILTER_VERSION = 'vn-prefilter-v1';
export const FILTER_STATE_KEY = 'smartTopPrefilterState';
export const SECTIONS = ['news_vietnam', 'tech_vietnam'];
export const prefilterEnabled = () => !/^(0|false|off)$/i.test(process.env.SMART_TOP_VN_PREFILTER_ENABLED || 'true');

// Deliberately broad KEEP guards: a false negative costs work; a false positive hides news.
const guards = {
  public_consequence: /\b(court|judgment|ruling|law|regulation|policy change|health|disease|flood|typhoon|disaster|casualt|collapse|investigation|corruption|diplomatic|security|emergency|mortality|hospital|pollution|education reform|unemployment|poverty|mortality|economic deterioration|income collapse)\b|\b(toa an|phap luat|nghi quyet|nghi dinh|ban hanh|quyet dinh|chi thi|phe duyet|ngan sach|chinh sach|benh|dich benh|tu vong|thiet mang|lu lut|bao lu|thien tai|sap san|dieu tra|tham nhung|ngoai giao|an ninh|an toan|o nhiem|moi truong|giao duc|y te|khan cap|khoa sim|khoa tai khoan|siet quan ly|that nghiep|thu nhap|khung hoang|thiet hai)\b/,
  structural_capacity: /\b(factory|fab|data cent(?:er|re)|cloud region|telecom infrastructure|national laboratory|r&d cent(?:er|re)|critical infrastructure|supply.chain|technology transfer|semiconductor facility)\b|\b(nha may|trung tam du lieu|ha tang vien thong|phong thi nghiem|day chuyen|chuoi cung ung|chuyen giao cong nghe|ha tang so|trong yeu|cap quoc gia|tren toan quoc|dao lo|khong gian tam thap)\b|500\s*kv/,
  binding_or_funded_action: /\b(committed|funded|(?<!non )binding|acquisition|construction|procurement|entered service|production started|deployment|investment)\b|\b(khoi cong|van hanh|san xuat hang loat|mua lai|sat nhap|cap phep|dau tu|rot von|tai tro|giai ngan|lien doanh|hop dong|trien khai dien rong)\b/,
  major_failure: /\b(outage|cyberattack|ransomware|breach|critical failure)\b|\b(sap|gian doan|ngung hoat dong|tan cong mang|ro ri|mat du lieu|su co)\b/,
  meaningful_scale: /\b(billion|hyperscale|nationwide deployment|national critical infrastructure)\b|\b(ty usd|ti usd|ty dong|ti dong|trieu usd|quy mo lon|hang loat|thay the hang nhap khau|lan dau che tao)\b|\d[\d.,]*\s*(?:mw|gw|ha)\b/,
};

export const TECH_RULES = [
  ['TECH_VN_RANKING_OR_INDEX', /\b(ranking|innovation index|readiness index|ranked|league table)\b|\b(xep hang|thang hang|chi so gii|dung thu \d+|dan dau ca nuoc ve doi moi|chi so doi moi|chi so san sang)\b/],
  ['TECH_VN_SURVEY_OR_ADOPTION_STAT', /\b(survey|adoption survey|user poll)\b|\b(khao sat|tham do)\b|\d+\s*percent.*\b(dung ai|su dung ai|thu nghiem ai|use ai|tested ai)\b/],
  ['TECH_VN_GENERIC_TARGET_OR_AMBITION', /\b(aims to|aspires to|could become)\b|\b(phan dau|co the tro thanh|huong toi.*(?:2030|2045)|can chuyen tu su dung|muc tieu.*(?:2030|2045))\b/],
  ['TECH_VN_EVENT_OR_EXHIBITION', /\b(conference|exhibition|workshop|showcase|ceremony)\b|\b(gian hang|trien lam|hoi thao|ngay hoi|khai mac|chuoi hoat dong|khu trung bay)\b/],
  ['TECH_VN_AWARD_OR_CONTEST', /\b(awards?|contest|nomination|prize)\b|\b(thang giai|giai thuong|vinh danh|de cu|cuoc thi)\b/],
  ['TECH_VN_NON_BINDING_PARTNERSHIP', /\b(mou|non.binding|will explore|vague cooperation)\b|\b(bien ban ghi nho|bat tay|hop tac chien luoc|se nghien cuu hop tac)\b/],
  ['TECH_VN_MINOR_PILOT_OR_DEMO', /\b(small pilot|tiny demonstration|proof of concept|demo)\b|\b(trinh dien|thi diem nho|thu nghiem quy mo nho|robot dau co)\b/],
  ['TECH_VN_MINOR_TRAINING_OR_RESEARCH', /\b(minor research|small grant|digital.skills|training workshop|university networking)\b|\b(ky nang so|ket noi nha khoa hoc|mo rong dao tao|khoa dao tao|tap huan)\b/],
  ['TECH_VN_CORPORATE_TECH_PR', /\b(internal ai|ai assistant|corporate case study|ai agents)\b|\b(tro ly ai|tro thu.*ung dung|nhan su ai|ung dung ai vao san xuat noi dung)\b/],
  ['TECH_VN_MINOR_LOCAL_DIGITALIZATION', /\b(local digitization|school digitization|province digitizes)\b|\b(so hoa (?:ho so|du lieu)|ket noi du lieu|chuyen doi so den gan)\b/],
];
export const NEWS_RULES = [
  ['VN_NEWS_RANKING_OR_VANITY_METRIC_ONLY', /\b(?:rises?|moves? up) one place.*(?:index|ranking)|\b(?:tang|len) (?:mot|1) bac.*(?:xep hang|chi so)\b/],
  ['VN_NEWS_GENERIC_ASPIRATION_OR_SPEECH', /\bceremonial speech.*aims? to.*2045\b|\b(?:phan dau|huong toi|muc tieu).*do thi hien dai.*2045\b/],
  ['VN_NEWS_CEREMONIAL_EVENT_ONLY', /\broutine (?:anniversary|ceremony)\b|\ble ky niem thuong nien\b/],
];

export function materialitySignals(article, section) {
  const text = normalizeText([article.title, article.content, article.description, article.summary].filter(Boolean).join(' '));
  return Object.entries(guards).filter(([key, rule]) =>
    (section === 'tech_vietnam' || key === 'public_consequence' || key === 'major_failure' || key === 'binding_or_funded_action' || key === 'structural_capacity') && rule.test(text)
  ).map(([key]) => key);
}
export function evaluatePolicy(article, section) {
  const title = normalizeText((article.title || '').replaceAll('%', ' percent '));
  const overrides = materialitySignals(article, section);
  const keep = { status: 'keep', final: false, reasonCode: null, reason: overrides.length ? 'Potentially consequential development; retain for editorial judgment.' : 'Insufficient evidence for safe early exclusion.', signals: [], materialitySignals: overrides };
  if (overrides.length) return keep;
  const code = (section === 'tech_vietnam' ? TECH_RULES : NEWS_RULES).find(([, rule]) => rule.test(title))?.[0];
  if (!code) return keep;
  return { status: 'exclude', final: true, reasonCode: code, reason: `Clear ${code.toLowerCase().replaceAll('_', ' ')} without a public-interest/materiality override in available metadata.`, signals: [code], materialitySignals: [] };
}
export function validReason(section, code) {
  return (section === 'tech_vietnam' ? TECH_RULES : NEWS_RULES).some(([reason]) => reason === code);
}

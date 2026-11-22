import { getPrefilterStore } from './state.js';
import { retiredReason } from './retired-reasons.js';

const norm = value => String(value || '').replace(/<[^>]*>/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
const labels = { RANKING_OR_INDEX: 'Ranking/index only', RANKING_OR_VANITY_METRIC_ONLY: 'Ranking/index only', SURVEY_OR_ADOPTION_STAT: 'Survey-only story', GENERIC_TARGET_OR_AMBITION: 'Generic ambition', GENERIC_ASPIRATION_OR_SPEECH: 'Generic aspiration or speech', EVENT_OR_EXHIBITION: 'Conference/exhibition only', AWARD_OR_CONTEST: 'Award or contest', NON_BINDING_PARTNERSHIP: 'Non-binding partnership', MINOR_PILOT_OR_DEMO: 'Minor pilot or demo', MINOR_TRAINING_OR_RESEARCH: 'Minor training or research', CORPORATE_TECH_PR: 'Corporate PR', MINOR_LOCAL_DIGITALIZATION: 'Minor local digitization', CEREMONIAL_EVENT_ONLY: 'Routine ceremony' };
// System editorial decisions only. The old AI personal rules no longer exist.
export async function filterLog(db, { origin = 'all', search = '', offset = 0, limit = 100 } = {}) {
    const system = await getPrefilterStore(db);
    let rows = [];
    for (const record of system.records.values()) for (const decision of Object.values(record.decisions)) {
        if (decision.status !== 'exclude' || !decision.final || retiredReason(decision.reasonCode)) continue;
        const code = String(decision.reasonCode || '').replace(/^(TECH_VN_|VN_NEWS_|VN_)/, '');
        rows.push({ ...decision, id: decision.decisionId, timestamp: decision.evaluatedAt, origin: 'system_editorial', title: decision.title || record.identity.title, canonicalUrl: record.identity.url, source: decision.source || '', humanReason: labels[code] || decision.reason, active: true, matchConfidence: 'high' });
    }
    rows = rows.filter(row => (origin === 'all' || row.origin === origin) && (!search || norm([row.title, row.humanReason, row.source, row.section].join(' ')).includes(norm(search)))).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

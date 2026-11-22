// Shared, dependency-free semantic vocabulary used by the picker and server.
// No persistence, network, or user inference belongs in this module.
const SmartFeedbackSemantics = (() => {
    const norm = value => String(value || '').replace(/<[^>]*>/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
    const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const types = [
        ['routine_sales_update', 'routine sales updates', /\b(deliveries|monthly sales|sales updates|delivery updates|sales report|doanh so|ban giao xe)\b/],
        ['ranking_or_index', 'ranking/index stories', /\b(ranking|ranked|index ranking|xep hang|chi so doi moi)\b/],
        ['survey_or_statistic', 'survey/statistic stories', /\b(survey|poll|khao sat|tham do)\b|\d+%.*\b(ai|adoption|doanh nghiep)\b/],
        ['generic_aspiration', 'generic targets and aspirations', /\b(aims to|aspires|could become|phan dau|huong toi|muc tieu)\b/],
        ['conference_or_exhibition', 'conference/exhibition stories', /\b(conference|exhibition|hoi thao|trien lam)\b/],
        ['award_or_contest', 'award/contest stories', /\b(award|awards|contest|giai thuong|vinh danh|cuoc thi)\b/],
        ['non_binding_mou', 'non-binding partnerships', /\b(mou|non binding|bien ban ghi nho)\b/],
        ['minor_pilot', 'minor pilots and demos', /\b(demo|minor pilot|small pilot|thi diem nho|trinh dien)\b/],
        ['product_update', 'ordinary product updates', /\b(feature update|app update|new feature|tinh nang moi|cap nhat ung dung)\b/],
        ['routine_earnings', 'routine earnings reports', /\b(quarterly earnings|earnings report|bao cao loi nhuan)\b/],
        ['sports_result', 'routine sports results', /\b(match result|football result|scores|ket qua tran|ti so|ty so)\b/],
        ['transfer_rumor', 'football transfer rumors', /\b(transfer rumor|transfer rumour|tin don chuyen nhuong)\b/],
        ['private_life', 'personal/relationship stories', /\b(personal life|private life|relationship|dating|romance|doi tu|tinh cam|hen ho)\b/],
        ['rumor', 'rumor stories', /\b(rumor|rumour|rumors|rumours|tin don)\b/],
        ['opinion', 'opinion pieces', /\b(opinion|commentary|goc nhin|binh luan)\b/],
        ['corporate_pr', 'promotional / corporate PR stories', /\b(corporate pr|promotional|sponsored|quang ba|quang cao|pr doanh nghiep)\b/],
    ];
    const topics = [ ['AI', /\b(ai|artificial intelligence|tri tue nhan tao)\b/], ['electric vehicles', /\b(ev|electric vehicle|electric vehicles|xe dien)\b/], ['football', /\b(football|soccer|bong da)\b/], ['smartphones', /\b(smartphone|smartphones|dien thoai)\b/], ['banking', /\b(banking|ngan hang)\b/], ['crypto', /\b(crypto|bitcoin|tien ma hoa)\b/], ['entertainment', /\b(celebrity|idol|singer|ca si|giai tri)\b/] ];
    const majorPattern = /\b(bankruptcy|bankrupt|pha san|critical|zero day|breach|cyberattack|bankrupt|security incident|enacted|denies|denial|cancelled|canceled|approved|commits|committed|billion|funded|investigation|court|disaster|death|tu vong|toa an|dieu tra|phu nhan|phe duyet|ban hanh|khoi cong|ty usd|tan cong mang|thien tai|khan cap)\b/;
    const section = article => {
        const value = String(article.feedbackSection || article.topStory?.feed || article.smartCategory || article.category || 'smart').replace(/_world$/, '_global');
        return !value.includes('_') && article.region && ['news','tech','finance'].includes(value) ? value + '_' + (article.region === 'vietnam' ? 'vietnam' : 'global') : value;
    };
    function traits(article) {
        const stored = article.feedbackTraits || {};
        const headline = norm(article.title);
        const evidence = norm([article.title, article.description, article.excerpt, article.content, article.summary].filter(v => typeof v === 'string').join(' '));
        const entities = [...(Array.isArray(stored.entities) ? stored.entities : []), ...(Array.isArray(article.entities) ? article.entities : [])].map(v => text(v?.name || v)).filter(Boolean);
        for (const name of ['VinFast', 'Apple', 'Elon Musk', 'Taylor Swift', 'Nvidia', 'Microsoft', 'Google', 'Samsung', 'OpenAI', 'Tesla']) {
            if (` ${evidence} `.includes(` ${norm(name)} `)) entities.push(name);
        }
        const eventTypes = types.filter(([, , regex]) => regex.test(headline)).map(([id]) => id);
        // Cached AI traits describe the main event, not incidental body mentions.
        for (const key of ['eventType', 'storyFormat', 'storyAngle']) if (typeof stored[key] === 'string') eventTypes.push(stored[key]);
        const detectedTopics = topics.filter(([, re]) => re.test(headline)).map(([name]) => name);
        return { section: section(article), entities: [...new Set(entities)].slice(0, 12), topics: [...new Set([stored.topic, stored.subtopic, ...detectedTopics].filter(Boolean))],
            eventTypes: [...new Set(eventTypes)], major: stored.materialityClass === 'major' || majorPattern.test(evidence),
            routine: stored.materialityClass === 'routine' || stored.materialityClass === 'minor' || eventTypes.some(id => !['rumor', 'opinion'].includes(id)),
            source: text(article.feedUrl || article.feedTitle || article.source), stored };
    }
    const semanticKey = rule => {
        const canonical = { ...rule };
        if (canonical.eventType === 'corporate_pr') { canonical.dimension = 'quality'; canonical.storyAngle = 'corporate_pr'; delete canonical.eventType; }
        return JSON.stringify(Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, norm(value)]));
    };
    function isRejected(rule, rejected) {
        const current = Object.fromEntries(JSON.parse(semanticKey(rule)));
        return rejected.some(id => {
            if (id === semanticKey(rule)) return true;
            try {
                const previous = Object.fromEntries(JSON.parse(id));
                const constraints = Object.entries(previous).filter(([key]) => !['dimension','scope','strength'].includes(key));
                // Do not recycle a rejected entity/type as a narrower paraphrase.
                return constraints.length > 0 && constraints.every(([key, value]) => current[key] === value);
            } catch { return false; }
        });
    }
    const reason = (label, rule) => ({ id: semanticKey(rule), label, rule });
    function pool(article) {
        const t = traits(article), scope = t.section, reasons = [];
        for (const entity of t.entities) reasons.push(reason(`Show fewer routine ${entity} stories`, { dimension: 'entity', entity, scope, strength: 'routine_only' }));
        for (const id of t.eventTypes) {
            const entry = types.find(([key]) => key === id);
            if (entry) reasons.push(reason(`Don't show ${entry[1]}`, { dimension: 'story_type', eventType: id, scope, strength: 'narrow' }));
        }
        for (const topic of t.topics) reasons.push(reason(`Not interested in ${topic}`, { dimension: 'topic', topic, scope, strength: 'topic' }));
        reasons.push(reason('Already seen this development', { dimension: 'repetition', scope, strength: 'same_event' }));
        reasons.push(reason('Too trivial / not important enough', { dimension: 'materiality', scope, strength: 'routine_only', ...(t.eventTypes[0] ? { eventType: t.eventTypes[0] } : t.topics[0] ? { topic: t.topics[0] } : {}) }));
        reasons.push(reason('Too promotional / PR', { dimension: 'quality', storyAngle: 'corporate_pr', scope, strength: 'narrow' }));
        if (t.source) reasons.push(reason(`Hide Smart stories from ${text(article.feedTitle || t.source)}`, { dimension: 'source', source: t.source, scope, strength: 'source' }));
        // Specific conjunctions differ from a broad entity/topic rejection.
        for (const entity of t.entities) for (const eventType of t.eventTypes) reasons.push(reason(`Don't show ${entity} ${types.find(([id]) => id === eventType)?.[1] || eventType}`, { dimension: 'story_type', entity, eventType, scope, strength: 'narrow' }));
        return [...new Map(reasons.map(r => [r.id, r])).values()];
    }
    function interpret(input, article) {
        const value = norm(input), t = traits(article), scope = t.section;
        if (!value) return null;
        const entity = t.entities.find(name => ` ${value} `.includes(` ${norm(name)} `));
        const angle = types.find(([, , re]) => re.test(value));
        const topic = topics.find(([, re]) => re.test(value))?.[0];
        // Explicit review still required. Unknown clauses are never silently discarded.
        if (entity && /\b(hide all|block all|an tat ca)\b/.test(value) && !angle) return reason(`Hide ALL Smart stories about ${entity} in ${scope}`, { dimension: 'entity', entity, scope, strength: 'hide_all_entity' });
        if (angle) return reason(`Hide ${entity ? entity + ' ' : ''}${angle[1]}${topic && !entity ? ' about ' + topic : ''} in ${scope}; keep major developments`, { dimension: 'story_type', ...(entity ? { entity } : {}), ...(topic && !entity ? { topic } : {}), eventType: angle[0], scope, strength: 'narrow' });
        if (/\b(already seen|da xem)\b/.test(value)) return reason('Hide this unchanged event only', { dimension: 'repetition', scope, strength: 'same_event' });
        return null;
    }
    function validRule(rule) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
        const allowed = ['dimension', 'scope', 'strength', 'entity', 'topic', 'eventType', 'storyAngle', 'source'];
        if (Object.keys(rule).some(key => !allowed.includes(key) || typeof rule[key] !== 'string' || !rule[key].trim() || rule[key].length > 250)) return false;
        if (!rule.scope || !rule.strength) return false;
        const dimensions = { entity: 'entity', topic: 'topic', story_type: 'eventType', quality: 'storyAngle', source: 'source', materiality: null, repetition: null };
        if (!Object.hasOwn(dimensions, rule.dimension) || (dimensions[rule.dimension] && !rule[dimensions[rule.dimension]])) return false;
        if (rule.strength === 'hide_all_entity') return rule.dimension === 'entity' && !rule.eventType && !rule.storyAngle && !rule.topic;
        const strengths = { entity: ['routine_only'], topic: ['topic', 'narrow'], story_type: ['narrow', 'routine_only'], quality: ['narrow'], materiality: ['routine_only'], source: ['source'], repetition: ['same_event'] };
        return strengths[rule.dimension].includes(rule.strength);
    }
    function matches(rule, article, requestedSection = section(article)) {
        if (!validRule(rule) || (rule.scope !== 'smart' && rule.scope !== requestedSection && !requestedSection.startsWith(rule.scope + '_'))) return false;
        if (rule.dimension === 'repetition') return false; // identity/event revisions, never a topic heuristic
        const t = traits(article);
        if (rule.entity && !t.entities.some(e => norm(e) === norm(rule.entity))) return false;
        if (rule.topic && !t.topics.some(e => norm(e) === norm(rule.topic))) return false;
        if (rule.source && norm(t.source) !== norm(rule.source)) return false;
        if (rule.strength === 'hide_all_entity') return true;
        if (['narrow', 'routine_only'].includes(rule.strength) && t.major) return false;
        if (rule.eventType && !t.eventTypes.includes(rule.eventType)) return false;
        if (rule.storyAngle && !t.eventTypes.includes(rule.storyAngle)) return false;
        if (rule.strength === 'routine_only' && !t.routine) return false;
        return true;
    }
    return { norm, text, types, traits, section, pool, reason, semanticKey, isRejected, interpret, validRule, matches };
})();
if (typeof globalThis !== 'undefined') globalThis.SmartFeedbackSemantics = SmartFeedbackSemantics;

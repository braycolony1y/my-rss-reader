import { getArticleId, stableId } from '../articles/identity.js';
import { detectArticleLanguage } from '../articles/language.js';
import { chooseRepresentative } from '../clustering/representative.js';
import { safeDate } from '../dates/publication-time.js';

function buildVerificationPrompt(articles) {
  const input =
    articles.map(article => ({
      id: getArticleId(article),
      title: article.title,
      description:
        String(
          article.content || ''
        ).slice(0, 600),
      source:
        article.feedTitle,
      domain:
        article.domain,
      language:
        article.language ||
        detectArticleLanguage(
          article
        ),
      category:
        article.smartCategory,
      publishedAt:
        article.pubDate
    }));

  return [
    'You are a precise multilingual exact-event clustering verifier.',
    '',
    'Partition the supplied articles into exact-event clusters.',
    '',
    'Group articles together only when they describe the same specific real-world occurrence.',
    '',
    'EDITORIAL ANGLE IS NOT AN EVENT STAGE.',
    'If two articles report the same concrete occurrence, differences in headline framing, historical context, consequences, takeaways, vote details, user impact, or explanatory emphasis do not by themselves make them separate events.',
    'A distinct follow-up action or reaction remains a separate event when that response itself is the primary news occurrence rather than merely framing of the original event.',
    '',
    'Do not group articles merely because they share:',
    '- the same broad topic;',
    '- the same person;',
    '- the same company;',
    '- the same city or country;',
    '- the same crime type;',
    '- the same market or industry;',
    '- the same product family;',
    '- the same tournament;',
    '- the same category;',
    '- the same ongoing story.',
    '',
    'The central action and the relevant people, organizations, object, place, and event time or event stage must be compatible.',
    '',
    'Different stages may represent separate events, including investigation, arrest, charge, trial, conviction, sentencing, appeal, and a sentence being upheld or overturned.',
    '',
    'For sports, predictions and previews may be grouped only when they concern the same fixture and the same leg or stage.',
    'Keep player availability or selection stories, VIP attendance, tournament administration, match reports, and post-match reactions separate when their primary news peg differs.',
    'A secondary reference to the same team, tournament, or match does not make two articles the same event.',
    'Every article in a cluster must match the central event directly; do not create a cluster through a chain of loosely related articles.',
    '',
    'Different languages or categories do not by themselves mean that articles describe different events.',
    '',
    'Do not invent facts.',
    'Do not rewrite headlines.',
    'Do not generate summaries.',
    'Do not assign Importance.',
    'Do not modify article IDs.',
    '',
    'Every input article ID must appear exactly once.',
    'Do not omit IDs.',
    'Do not duplicate IDs.',
    'Do not invent IDs.',
    '',
    'When the metadata is insufficient for a safe partition, keep questionable articles separate and set uncertain to true.',
    '',
    'Return valid JSON matching the supplied schema only.',
    '',
    JSON.stringify(
      { articles: input }
    )
  ].join('\n');
}

function buildComponentReviewUnits(group) {
  const reviewArticles =
    group?.fullRepartition && Array.isArray(group?.reviewUniverse) && group.reviewUniverse.length
      ? group.reviewUniverse
      : (group?.articles || []);

  const articleById = new Map(
    reviewArticles.map(article => [getArticleId(article), article])
  );

  const sourceComponents =
    Array.isArray(group?.deferredComponents) && group.deferredComponents.length
      ? group.deferredComponents
      : reviewArticles.map(article => [article]);

  const assigned = new Set();
  const cleanComponents = [];

  for (const component of sourceComponents) {
    const clean = [];
    for (const item of component || []) {
      const article =
        typeof item === 'string'
          ? articleById.get(item)
          : articleById.get(getArticleId(item)) || item;
      if (!article) continue;
      const articleId = getArticleId(article);
      if (!articleId || assigned.has(articleId)) continue;
      assigned.add(articleId);
      clean.push(article);
    }
    if (clean.length) cleanComponents.push(clean);
  }

  for (const article of reviewArticles) {
    const articleId = getArticleId(article);
    if (!articleId || assigned.has(articleId)) continue;
    assigned.add(articleId);
    cleanComponents.push([article]);
  }

  return cleanComponents.map(component => {
    const articleIds = component.map(getArticleId).sort();
    const representative = chooseRepresentative(component) || component[0];
    const ordered = [...component].sort(
      (left, right) => safeDate(right.pubDate) - safeDate(left.pubDate)
    );
    const timestamps = component.map(article => safeDate(article.pubDate)).filter(Boolean);

    return {
      id: `component_${stableId(articleIds.join('|'))}`,
      articleIds,
      articleCount: articleIds.length,
      representativeTitle: representative?.title || '',
      representativeExcerpt: String(
        representative?.content || representative?.description || representative?.summary || ''
      ).slice(0, 700),
      publishedFrom: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      publishedTo: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      sources: [...new Set(component.map(article => article.feedTitle).filter(Boolean))].slice(0, 10),
      headlines: ordered.slice(0, 8).map(article => ({
        title: article.title,
        source: article.feedTitle,
        publishedAt: article.pubDate
      })),
      destination: representative?.smartCategory || representative?.feedCategory || null
    };
  });
}

function buildComponentReviewPrompt(units) {
  const input = units.map(unit => ({
    id: unit.id,
    articleCount: unit.articleCount,
    representativeTitle: unit.representativeTitle,
    representativeExcerpt: unit.representativeExcerpt,
    publishedFrom: unit.publishedFrom,
    publishedTo: unit.publishedTo,
    sources: unit.sources,
    headlines: unit.headlines,
    destination: unit.destination
  }));

  return [
    'You are reviewing deterministic exact-event components from a news clustering system.',
    '',
    'Answer TWO separate questions:',
    '1. Which components describe the SAME exact real-world occurrence and may be merged?',
    '2. Which remaining exact events are distinct developments in the SAME broader story or timeline?',
    '',
    'SAME_EVENT is strict. Merge components only when the central action, subjects, object, place, and event stage are compatible.',
    'Different stages such as announcement, investigation, approval, arrest, charge, trial, ruling, appeal, launch, recall, earnings release, policy response, and deal closing are normally separate exact events.',
    '',
    'EDITORIAL ANGLE IS NOT AN EVENT STAGE.',
    'If components describe the same concrete real-world action or status change, keep them in the SAME_EVENT group even when different publishers emphasize different consequences, audiences, operators, devices, historical context, user advice, or reactions.',
    'A genuinely distinct response, follow-up action, enforcement step, market move, or later consequence is separate when it becomes the primary news occurrence rather than merely another framing of the original event.',
    '',
    'For shutdowns, retirements, activations, deadlines, migrations, bans, launches, and other effective-date transitions, strongly prefer SAME_EVENT when these anchors match:',
    '- the same system, service, policy, product, network, program, or other affected object;',
    '- the same concrete action or resulting status change;',
    '- the same geographic or organizational scope;',
    '- the same effective date or materially identical effective window.',
    '',
    'Examples of framing differences that should NOT split an otherwise identical event:',
    '- "officially shut down", "stopped from today", and "ended at midnight";',
    '- a carrier-specific or company-specific headline describing its participation in the same nationwide transition;',
    '- "what users need to do", device compatibility, subscriber impact, or migration advice caused directly by that same transition;',
    '- historical or nostalgic framing about a product or technology whose retirement is the same current event.',
    '',
    'Keep components separate when they actually report a different occurrence, such as an earlier announcement, a postponement or extension, an exception, a later enforcement action, a separate company decision outside the shared transition, or a materially different effective date.',
    '',
    'RELATED_DEVELOPMENT means separate exact events that belong to one concrete evolving story or causal/chronological sequence.',
    'Do not mark components related merely because they share a broad topic, company, person, country, industry, product family, tournament, or recurring issue.',
    '',
    'Every input component ID must appear exactly once in exactEventGroups.',
    'A one-component exactEventGroup means keep that component as its own event.',
    'relatedDevelopments must contain only pairs of component IDs that belong to DIFFERENT exactEventGroups.',
    'Pairs omitted from relatedDevelopments are treated as UNRELATED.',
    'Do not invent facts, rewrite headlines, omit IDs, duplicate IDs, or create new IDs.',
    'When evidence is insufficient for a safe decision, set uncertain to true.',
    '',
    'Return valid JSON matching the supplied schema only.',
    '',
    JSON.stringify({ components: input })
  ].join('\n');
}

export { buildVerificationPrompt, buildComponentReviewUnits, buildComponentReviewPrompt };

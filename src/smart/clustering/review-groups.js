import { getArticleId, createGroupId } from '../articles/identity.js';
import { postValidatePartition } from '../verification/validation.js';
import { detectEventConflicts } from './event-evidence.js';

function prepareIncrementalReviewGroups(groups, automatic) {
  const owner = new Map();
  const articleById = new Map();

  automatic.forEach((group, index) => {
    group.articles.forEach(article => {
      const articleId = getArticleId(article);
      owner.set(articleId, index);
      articleById.set(articleId, article);
    });
  });

  for (const group of groups) {
    for (const article of group.articles || []) {
      articleById.set(getArticleId(article), article);
    }
  }

  const uniqueArticles = articles =>
    [...new Map(
      (articles || []).map(article => [getArticleId(article), article])
    ).values()];

  const dedupeComponents = components => {
    const result = [];
    const seen = new Set();
    for (const component of components || []) {
      const articles = uniqueArticles(component).sort((left, right) =>
        getArticleId(left).localeCompare(getArticleId(right))
      );
      if (!articles.length) continue;
      const key = articles.map(getArticleId).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(articles);
    }
    return result;
  };

  const result = groups.map(group => {
    const originalArticles = uniqueArticles(group.articles || []);
    const storedComponents = Array.isArray(group.deterministicComponents)
      ? group.deterministicComponents.map(componentIds =>
        (componentIds || [])
          .map(articleId => articleById.get(articleId))
          .filter(Boolean)
      )
      : [];
    const affected = [...new Set(originalArticles.map(article => owner.get(getArticleId(article))))]
      .filter(index => index !== undefined);
    const affectedComponents = affected.map(index => automatic[index].articles);
    const established = affected.filter(index => automatic[index].established || automatic[index].articles.length > 1);
    const conflict = established.some(index => automatic[index].articles.some(member =>
      originalArticles.some(article => owner.get(getArticleId(article)) !== index && detectEventConflicts(member, article).hasHardConflict)));
    const fullRepartition = established.length > 1 || conflict;
    const articles = fullRepartition ? affected.flatMap(index => automatic[index].articles) : affected.flatMap(index => {
      const component = automatic[index];
      if (!established.includes(index)) return component.articles;
      return [component.articles.slice().sort((a, b) => getArticleId(a).localeCompare(getArticleId(b)))[0]];
    });
    const deferredComponents = dedupeComponents([
      ...storedComponents,
      ...affectedComponents
    ]);
    const reviewUniverse = uniqueArticles([
      ...originalArticles,
      ...deferredComponents.flat()
    ]);

    return {
      ...group,
      articles: articles.length ? uniqueArticles(articles) : originalArticles,
      fullRepartition,
      deferredComponents:
        deferredComponents.length
          ? deferredComponents
          : originalArticles.map(article => [article]),
      reviewUniverse
    };
  });

  // Structural groups sharing a component must be partitioned together.
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length;) {
      const ids = new Set(result[i].articles.map(getArticleId));
      if ((result[i].fullRepartition || result[j].fullRepartition) && result[j].articles.some(a => ids.has(getArticleId(a)))) {
        const merged = new Map([...result[i].articles, ...result[j].articles].map(a => [getArticleId(a), a]));
        const touched = new Set(
          [...merged.keys()]
            .map(id => owner.get(id))
            .filter(index => index !== undefined)
        );
        const touchedArticles = [...touched].flatMap(index => automatic[index].articles);
        const deferredComponents = dedupeComponents([
          ...(result[i].deferredComponents || []),
          ...(result[j].deferredComponents || []),
          ...[...touched].map(index => automatic[index].articles)
        ]);
        const reviewUniverse = uniqueArticles([
          ...(result[i].reviewUniverse || []),
          ...(result[j].reviewUniverse || []),
          ...touchedArticles,
          ...deferredComponents.flat()
        ]);
        result[i] = {
          ...result[i],
          fullRepartition: true,
          articles: touchedArticles.length ? uniqueArticles(touchedArticles) : uniqueArticles([...merged.values()]),
          deferredComponents,
          reviewUniverse
        };
        result.splice(j, 1);
        i = -1;
        break;
      } else {
        j++;
      }
    }
  }

  return result.map(group => ({
    ...group,
    id: createGroupId(group.articles)
  }));
}

function integrateIncrementalReviews(automatic, reviewed, requests) {
  const broadIds = new Set(
    requests
      .filter(group => group.fullRepartition)
      .flatMap(group => (group.reviewUniverse || group.articles).map(getArticleId))
  );
  let groups = automatic.map(group => ({ ...group, articles: group.articles.filter(a => !broadIds.has(getArticleId(a))) })).filter(g => g.articles.length);
  for (const partition of reviewed) {
    if (partition.verification?.method === 'deferred') {
      const deferredIds = new Set(partition.articles.map(getArticleId));
      groups = groups.filter(group =>
        !group.articles.some(article => deferredIds.has(getArticleId(article)))
      );
      groups.push(partition);
      continue;
    }
    if (partition.articles.some(a => broadIds.has(getArticleId(a)))) { groups.push(partition); continue; }
    // A negative pair decision leaves both automatic components intact.
    if (partition.articles.length < 2) continue;
    const ids = new Set(partition.articles.map(getArticleId));
    const touched = groups.filter(g => g.articles.some(a => ids.has(getArticleId(a))));
    const members = [...new Map(touched.flatMap(g => g.articles).map(a => [getArticleId(a), a])).values()];
    const proposed = { clusters: [{ articleIds: members.map(getArticleId) }], uncertain: false };
    if (!postValidatePartition(proposed, members)) {
      const error = new Error('Incremental match conflicts with established event; retaining previous clusters.');
      error.code = 'CLUSTER_VERIFICATION_UNRESOLVED'; throw error;
    }
    groups = groups.filter(g => !touched.includes(g));
    groups.push({ ...partition, articles: members });
  }
  // Do not turn an explicit AI separation into a merge through a different pair.
  for (const request of requests) {
    const partitions = reviewed.filter(partition => partition.reviewRequestId === request.id);
    if (
      partitions.length &&
      partitions.every(partition => partition.verification?.method === 'deferred')
    ) {
      continue;
    }
    const partitionById = new Map();
    partitions.forEach((partition, index) => partition.articles.forEach(article => partitionById.set(getArticleId(article), index)));
    if (groups.some(group => new Set(group.articles.map(article => partitionById.get(getArticleId(article))).filter(index => index !== undefined)).size > 1)) {
      const error = new Error('Affected comparisons disagree; retaining the last valid event state.');
      error.code = 'CLUSTER_VERIFICATION_UNRESOLVED'; throw error;
    }
  }
  return groups;
}

function deferredReviewPartitions(
  group,
  reason = 'verification_pending'
) {
  const deferredComponents =
    Array.isArray(group?.deferredComponents) &&
    group.deferredComponents.length
      ? group.deferredComponents
      : (group?.reviewUniverse || group?.articles || [])
        .map(article => [article]);

  return deferredComponents
    .filter(component => component?.length)
    .map(component => ({
      reviewRequestId: group.id,
      id: createGroupId(component),
      articles: component,
      verified: false,
      providerId: null,
      model: null,
      verifiedAt: null,
      verification: {
        method: 'deferred',
        reason
      }
    }));
}

export { prepareIncrementalReviewGroups, integrateIncrementalReviews, deferredReviewPartitions };

function stableId(value) {
  const text = String(value || '');

  let hash = 2166136261;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function getArticleId(article) {
  if (article?.link) {
    return `a_${stableId(article.link)}`;
  }

  if (article?.id) {
    return `a_${stableId(article.id)}`;
  }

  return `a_${stableId([
    article?.title,
    article?.pubDate,
    article?.feedTitle
  ].filter(Boolean).join('|'))}`;
}

function createGroupId(articles) {
  const ids = articles
    .map(getArticleId)
    .sort();

  return `g_${stableId(ids.join('|'))}`;
}

export { stableId, getArticleId, createGroupId };

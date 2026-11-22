const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);

export function systemLogMetadata(article, stage) {
    return { title: text(article.title), source: text(article.feedTitle), articleId: article.articleKey || article.id || article.link, clusterId: article.clusterId || null, pipelineStage: stage, origin: 'system_editorial' };
}

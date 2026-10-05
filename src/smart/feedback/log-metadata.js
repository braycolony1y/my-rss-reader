import { semantics as s } from './semantics.js';
export function systemLogMetadata(article, stage) {
    return { title: s.text(article.title), source: s.text(article.feedTitle), articleId: article.articleKey || article.id || article.link, clusterId: article.clusterId || null, pipelineStage: stage, origin: 'system_editorial' };
}

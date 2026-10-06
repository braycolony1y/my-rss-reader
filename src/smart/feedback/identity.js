import { createHash } from 'node:crypto';
import { articleIdentity } from '../prefilter/identity.js';

const cache = new WeakMap();
const fields = ['link', 'title', 'content', 'description', 'summary', 'feedUrl', 'guid', 'articleKey', 'contentHash'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Reuse only exact, unchanged inputs. Weak ownership does not keep old stories
// alive, and normalized full bodies are deliberately not retained.
function baseIdentity(article) {
    const inputs = fields.map(field => article[field]);
    const previous = cache.get(article);
    if (previous && inputs.every((value, i) => value === previous.inputs[i])) return previous.value;
    const value = articleIdentity(article);
    const compact = { key: value.key, revision: value.revision, title: value.safeTitle, keys: value.keys.map(([, key]) => key) };
    cache.set(article, { inputs, value: compact });
    return compact;
}

export function identity(article) {
    const value = baseIdentity(article);
    const clusterSignature = article.relatedArticles?.length
        ? digest(article.relatedArticles.map(member => baseIdentity(member).key).sort()) : null;
    return { key: clusterSignature ? digest([value.key, clusterSignature]) : value.key,
        clusterSignature, revision: value.revision, title: value.title, keys: value.keys,
        materialVersion: article.topStory?.material_version || null };
}

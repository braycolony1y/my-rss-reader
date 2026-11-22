// Independent scoped refreshes may finish before an older full refresh.
// Track successfully published feed generations per database owner so that
// late work cannot replace the newer source data or inferred feed metadata.
const owners = new WeakMap();
const publicationTails = new WeakMap();

// Hold the publication lane through both the database commit and watermark
// update. The database can start its next updater before our await resumes.
export function serializeFeedPublication(db, publish) {
    const previous = publicationTails.get(db) || Promise.resolve();
    const result = previous.catch(() => {}).then(publish);
    publicationTails.set(db, result);
    const cleanup = () => {if (publicationTails.get(db) === result) publicationTails.delete(db);};
    void result.then(cleanup, cleanup);
    return result;
}

export function beginFeedPublication(db) {
    let owner = owners.get(db);
    if (!owner) {
        owner = {generation: 0, published: new Map()};
        owners.set(db, owner);
    }
    const generation = ++owner.generation;
    return {
        select(articles, feeds) {
            const current = url => (owner.published.get(url) || 0) <= generation;
            return {articles: articles.filter(article => current(article.feedUrl)),
                feeds: feeds.filter(feed => current(feed.url))};
        },
        commit(articles) {
            for (const article of articles) {
                owner.published.set(article.feedUrl, Math.max(generation, owner.published.get(article.feedUrl) || 0));
            }
        }
    };
}

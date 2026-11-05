// Retain only a publication for the exact filter context. A refresh still
// applies authoritative membership/order, reusing unambiguous article objects.
const ReaderListPublication = {
    contexts: new WeakMap(),
    context(app) {
        return JSON.stringify([app.selectedFilterType, app.selectedFilterValue || '',
            app.selectedFilterType === 'smart' ? app.smartTabMode : '',
            Boolean(app.hideRead), app.searchQuery || '']);
    },
    retains(app) {
        return app.articles.length > 0 && this.contexts.get(app.__readerOwner || app) === this.context(app);
    },
    commit(app) { this.contexts.set(app.__readerOwner || app, this.context(app)); },
    reconcile(current, incoming) {
        const identity = article => article.clusterId ? `cluster:${article.clusterId}`
            : article.link ? `link:${article.link}` : null;
        const previous = new Map(), counts = new Map();
        for (const article of current) {
            const key = identity(article);
            previous.set(key, previous.has(key) ? null : article);
        }
        for (const article of incoming) {
            const key = identity(article);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return incoming.map(article => {
            const key = identity(article), existing = key && counts.get(key) === 1 && previous.get(key);
            if (!existing) return article;
            for (const field of Object.keys(existing)) {
                if (!Object.prototype.hasOwnProperty.call(article, field)) delete existing[field];
            }
            return Object.assign(existing, article);
        });
    }
};

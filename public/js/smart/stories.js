// Owns the Stories view state on the shared Alpine component: the coverage list of a
// clustered story and the pinned view token. Methods receive the Alpine proxy as this.
const ReaderSmartStories = {
    create() {
        return {
                storyCoverageOpen: {},
                smartViewToken: '',

                storyCoverage(article) {
                    const groups = new Map();

                    for (
                        const source of [
                            article,
                            ...(article.relatedArticles || [])
                        ]
                    ) {
                        let identity;

                        try {
                            identity = new URL(
                                source.domain
                                    ? `https://${source.domain}`
                                    : source.link
                            )
                            .hostname
                            .replace(/^(www\.|m\.)/, '');
                        }
                        catch {
                            identity =
                                source.feedTitle ||
                                source.feedUrl ||
                                source.link;
                        }

                        if (!identity) continue;

                        if (!groups.has(identity)) {
                            const name =
                                this.stripHtml(
                                    source.feedTitle ||
                                    source.sourceName ||
                                    source.source ||
                                    identity
                                );

                            groups.set(identity, {
                                identity,
                                name,
                                icon:
                                    source.feedIcon ||
                                    source.icon ||
                                    this.smartSourceIcon({
                                        domain: identity
                                    }),
                                articles: []
                            });
                        }

                        const publisher =
                            groups.get(identity);

                        if (
                            !publisher.articles.some(
                                item =>
                                    item.link === source.link
                            )
                        ) {
                            publisher.articles.push(source);
                        }

                        if (
                            !publisher.icon &&
                            source.feedIcon
                        ) {
                            publisher.icon =
                                source.feedIcon;
                        }
                    }

                    return [...groups.values()];
                },

                toggleStoryCoverage(article) {
                    const id =
                        article.clusterId ||
                        article.link;

                    this.storyCoverageOpen = {
                        ...this.storyCoverageOpen,
                        [id]:
                            !this.storyCoverageOpen[id]
                    };
                },

                nextStoryImage(event, article) {
                    return ReaderStoryImageFallback.next(this, event, article);
                },

                nextStoryImage(event, article) {
                    return ReaderStoryImageFallback.next(this, event, article);
                },
        };
    }
};

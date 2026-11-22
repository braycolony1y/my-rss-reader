// Owns board / folders on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderBoardFolders = {
    create() {
        return {
                boardModalOpen: false,
                boardModalArticle: null,
                boardSavePending: false,
                boardMutationVersion: 0,
                boardSavingFolder: null,
                newBoardFolderName: '',

                boardIdentity(article) {
                    const raw = typeof article === 'string' ? article : article?.resolvedLink || article?.originalLink || article?.link;
                    if (!raw) return '';
                    try {
                        const u = new URL(raw);
                        const match = u.pathname.match(/^\/(?:t|threads)\/(?:[^/]*\.)?(\d+)(?:\/|$)/i);
                        if (match) return `${u.hostname.toLowerCase()}:thread:${match[1]}`;
                    } catch {}
                    return this.normalizeStateLink(raw);
                },
                isOnBoard(article) {
                    const id = this.boardIdentity(article);
                    return !!id && ReaderBoardLookup.members(this.boardStates, url => this.boardIdentity(url)).has(id);
                },
                boardFolderFor(article) {
                    const id = this.boardIdentity(article);
                    if (!id) return null;
                    return ReaderBoardLookup.folders(this.userPreferences.boardFolderMappings || {}, url => this.boardIdentity(url)).get(id) || null;
                },
                openBoardModal(article) {
                    if (this.boardSavePending) return;
                    this.cacheNotice = '';
                    this.boardModalArticle = article;
                    this.newBoardFolderName = '';
                    this.boardModalOpen = true;
                },

                applyBoardFolderResult(data, article, folder) {
                    const id = this.boardIdentity(article);
                    if (data.thread_id) {
                        if (Object.hasOwn(data, 'folder')) folder = data.folder;
                        const existing = this.boardStates.find(url => this.boardIdentity(url) === id);
                        if (folder === null) this.boardStates = this.boardStates.filter(url => this.boardIdentity(url) !== id);
                        else if (!existing) this.boardStates = [...this.boardStates, data.url];
                        const mappings = { ...(this.userPreferences.boardFolderMappings || {}) };
                        for (const url of Object.keys(mappings)) if (this.boardIdentity(url) === id) delete mappings[url];
                        if (folder !== null) mappings[data.url] = folder;
                        this.userPreferences.boardFolderMappings = mappings;
                        if (folder !== null) this.userPreferences.boardFolders = [...new Set([...(this.userPreferences.boardFolders || []), folder])];
                    } else {
                        this.boardStates = data.boardStates;
                        this.userPreferences = { ...this.userPreferences, ...data.userPreferences };
                    }
                    if (data.cacheMember) this.cacheMembers[data.cacheMember.thread_id] = data.cacheMember;
                    // Keep the list, its order, loaded pages and viewport in place.
                    if (this.selectedFilterType === 'board' && (folder === null || (this.selectedFilterValue && this.selectedFilterValue !== folder))) {
                        const container = document.getElementById('scroll-container');
                        const scrollTop = container?.scrollTop;
                        this.articles = this.articles.filter(item => this.boardIdentity(item) !== id);
                        if (container && this.$nextTick) this.$nextTick(() => { container.scrollTop = scrollTop; });
                    }
                },

                async assignBoardFolder(folderName) {
                    if (this.boardSavePending) return;
                    if (!this.boardModalArticle) {
                        this.cacheNotice = 'Choose an article before saving to Board.';
                        return;
                    }

                    const source = this.boardModalArticle;
                    const id = this.boardIdentity(source);
                    const optimisticUrl = source.originalLink || source.link;

                    /*
                     * Optimistic Board mutation:
                     * make Save / Remove feel instant while durable persistence
                     * completes in the background.
                     */
                    const rollback = {
                        boardStates: [...this.boardStates],
                        userPreferences: {
                            ...this.userPreferences,
                            boardFolders: [...(this.userPreferences.boardFolders || [])],
                            boardFolderMappings: {
                                ...(this.userPreferences.boardFolderMappings || {})
                            }
                        },
                        articles: [...this.articles],
                        cacheMembers: { ...this.cacheMembers }
                    };

                    this.boardSavePending = true;
                    this.boardMutationVersion++;
                    this.boardSavingFolder = folderName;
                    this.cacheNotice = '';

                    /*
                     * Apply the compact result locally before doing any network
                     * or disk work.
                     */
                    this.applyBoardFolderResult(
                        {
                            thread_id: id,
                            url: optimisticUrl,
                            folder: folderName
                        },
                        source,
                        folderName
                    );

                    /*
                     * Close immediately. The request below may take seconds,
                     * but the user no longer waits on it.
                     */
                    this.boardModalOpen = false;

                    try {
                        // Board membership needs metadata only, never rendered
                        // HTML or embedded image payloads.
                        const article = {};

                        for (const key of [
                            'link',
                            'resolvedLink',
                            'title',
                            'feedUrl',
                            'feedTitle',
                            'feedCategory',
                            'pubDate'
                        ]) {
                            const value =
                                key === 'link'
                                    ? optimisticUrl
                                    : source[key];

                            if (typeof value === 'string') {
                                article[key] = value.slice(
                                    0,
                                    key === 'title' ? 2000 : 4096
                                );
                            }
                        }

                        if (
                            typeof source.image === 'string' &&
                            /^https?:\/\//i.test(source.image) &&
                            source.image.length <= 4096
                        ) {
                            article.image = source.image;
                        }

                        const data = await this.cacheRequest(
                            '/api/board-cache/folder',
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    article,
                                    folder: folderName,
                                    compact: true
                                }),
                                keepalive: true
                            }
                        );

                        /*
                         * Reconcile with the authoritative server result.
                         * Usually this is now a no-op visually.
                         */
                        this.applyBoardFolderResult(
                            data,
                            source,
                            folderName
                        );

                        this.cacheNotice = '';
                    } catch (e) {
                        /*
                         * Durable save failed: restore exactly what the user had
                         * before the optimistic mutation.
                         */
                        this.boardStates = rollback.boardStates;
                        this.userPreferences = rollback.userPreferences;
                        this.articles = rollback.articles;
                        this.cacheMembers = rollback.cacheMembers;

                        this.cacheNotice =
                            e?.message ||
                            'Could not save Board changes';

                        /*
                         * Re-open so the failure is visible and retryable.
                         */
                        this.boardModalOpen = true;
                    } finally {
                        this.boardSavePending = false;
                        this.boardSavingFolder = null;
                    }
                },

                createNewBoardFolder() {
                    const name = this.newBoardFolderName.trim();
                    if (name) this.assignBoardFolder(name);
                },

                async removeArticleFromBoard() {
                    await this.assignBoardFolder(null);
                },
        };
    }
};

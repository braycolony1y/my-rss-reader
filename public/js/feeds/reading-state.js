// Owns feeds / reading-state on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderFeedsReadingState = {
    create() {
        return {
                readStates: new Set(),
                recentReadAt: {},
                pendingReadLinks: new Set(),
                pendingUnreadLinks: new Set(),
                pendingRecentReadLinks: new Set(),
                pendingStateMutations: {},
                savedStates: [],
                boardStates: [],

                hiddenStates: [],
                markAllUndo: null,
                markAllUndoTimer: null,

                normalizeStateLink(link) {
                    let value = String(link || '');
                    if (value.includes('voz.vn/t/')) {
                        value = value
                            .replace(/[?#].*$/, '')
                            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
                            .replace(/\/+$/, '');
                    }
                    return value.replace(/\/+$/, '');
                },

                dedupeStateLinks(links) {
                    const unique = new Map();
                    for (const link of Array.isArray(links) ? links : []) {
                        const normalized = this.normalizeStateLink(link);
                        if (normalized) unique.set(normalized, normalized);
                    }
                    return [...unique.values()];
                },

                hiddenArticleCount() {
                    return this.dedupeStateLinks(this.hiddenStates).length;
                },

                stateMutationKey(list, link) {
                    return `${list}:${this.normalizeStateLink(link)}`;
                },

                queueStateMutation(list, link, present) {
                    if (!['savedStates', 'boardStates', 'hiddenStates'].includes(list)) return;
                    const normalized = this.normalizeStateLink(link);
                    if (!normalized) return;
                    const key = this.stateMutationKey(list, normalized);
                    this.pendingStateMutations = {
                        ...this.pendingStateMutations,
                        [key]: { list, link: normalized, present: Boolean(present) }
                    };
                    if (typeof this.saveState === 'function') this.saveState();
                },

                applyPendingStateMutations(list, values) {
                    let next = this.dedupeStateLinks(values || []);
                    for (const mutation of Object.values(this.pendingStateMutations || {})) {
                        if (!mutation || mutation.list !== list || !mutation.link) continue;
                        const target = this.normalizeStateLink(mutation.link);
                        next = next.filter(link => this.normalizeStateLink(link) !== target);
                        if (mutation.present) next.push(mutation.link);
                    }
                    return this.dedupeStateLinks(next);
                },

                async flushPendingStateMutations() {
                    const snapshot = Object.entries(this.pendingStateMutations || {});
                    for (const [key, mutation] of snapshot) {
                        if (!mutation?.link || !mutation?.list) continue;
                        try {
                            const res = await fetch('/api/toggle', {
                                method: 'POST', keepalive: true,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    link: mutation.link,
                                    list: mutation.list,
                                    forceAdd: mutation.present === true,
                                    forceRemove: mutation.present !== true
                                })
                            });
                            if (!res.ok) continue;
                            const current = this.pendingStateMutations?.[key];
                            if (current && current.present === mutation.present && current.link === mutation.link && current.list === mutation.list) {
                                const next = { ...this.pendingStateMutations };
                                delete next[key];
                                this.pendingStateMutations = next;
                            }
                        } catch (_) { /* Durable journal retries on visibility/reconciliation. */ }
                    }
                    if (typeof this.saveState === 'function') this.saveState();
                },

                async toggleState(list, link) {
                    if (!link) return;
                    if (list === 'boardStates' && this.isOnBoard(link)) {
                        if (this.boardSavePending) return;
                        this.boardSavePending = true;
                        this.boardMutationVersion++;
                        try {
                            const data = await this.cacheRequest('/api/board-cache/folder', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ article: link, folder: null, compact: true })
                            });
                            this.applyBoardFolderResult(data, link, null);
                        } catch (e) { this.cacheNotice = e.message; }
                        finally { this.boardSavePending = false; }
                        return;
                    }
                    const array = this[list];
                    const index = array.indexOf(link);
                    const isAdding = index === -1;
                    if (isAdding) {
                        array.push(link);
                        if (list === 'savedStates' || list === 'boardStates') {
                            const sourceArticle = [this.overlayArticle, ...(this.topStories || []), ...(this.articles || []), ...(this.displayedArticles || [])]
                                .filter(Boolean)
                                .find(article => [article.link, article.originalLink, article.resolvedLink].includes(link));
                            const params = new URLSearchParams({
                                url: link,
                                feedUrl: sourceArticle?.feedUrl || ''
                            });
                            fetch('/api/article-content?' + params.toString()).catch(() => {});
                        }
                        this.queueStateMutation(list, link, true);
                        void this.flushPendingStateMutations();
                    } else {
                        array.splice(index, 1);
                        this.queueStateMutation(list, link, false);
                        void this.flushPendingStateMutations();
                        

                    }
                    
                    if (list === 'hiddenStates') {
                         const article = this.articles.find(a => a.link === link);
                         if (article && !this.readStates.has(link)) {
                             if (isAdding) {
                                 if (this.unreadCounts.total > 0) this.unreadCounts.total--;
                                 if (this.unreadCounts.feeds[article.feedUrl] > 0) this.unreadCounts.feeds[article.feedUrl]--;
                                 let cat = article.feedCategory || 'Others';
                                 if (this.unreadCounts.categories[cat] > 0) this.unreadCounts.categories[cat]--;
                             } else {
                                 this.unreadCounts.total++;
                                 this.unreadCounts.feeds[article.feedUrl] = (this.unreadCounts.feeds[article.feedUrl] || 0) + 1;
                                 let cat = article.feedCategory || 'Others';
                                 this.unreadCounts.categories[cat] = (this.unreadCounts.categories[cat] || 0) + 1;
                             }
                         }
                    }
                    
                    if (typeof this.saveState === 'function') this.saveState();
                },

                async markAsReadExplicit(link) {
                    this.prefetchNextAfter(link);
                    if (!this.readStates.has(link)) {
                        this.pendingUnreadLinks.delete(link);
                        this.pendingReadLinks.add(link);
                        this.readStates = new Set([...this.readStates, link]);
                        
                        const article = this.articles.find(a => a.link === link);
                        if (article && !this.hiddenStates.includes(link)) {
                            if (this.unreadCounts.total > 0) this.unreadCounts.total--;
                            if (this.unreadCounts.feeds[article.feedUrl] > 0) this.unreadCounts.feeds[article.feedUrl]--;
                            let cat = article.feedCategory || 'Others';
                            if (this.unreadCounts.categories[cat] > 0) this.unreadCounts.categories[cat]--;
                        }

                        if (typeof this.saveState === 'function') this.saveState();

                        try {
                            const res = await fetch('/api/toggle', {
                                method: 'POST', keepalive: true,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ link, list: 'readStates', forceAdd: true })
                            });
                            if (res.ok) this.pendingReadLinks.delete(link);
                        } catch (_) { /* Retry on the next state sync. */ }
                    }
                },

                async markAllAsRead() {
                    const unreadInView = this.articles.filter(a => !this.readStates.has(a.link) && !this.hiddenStates.includes(a.link));
                    let linksToMark = unreadInView.map(a => a.link);
                    
                    // Also mark all related articles as read
                    unreadInView.forEach(a => {
                        if (a.relatedArticles && Array.isArray(a.relatedArticles)) {
                            a.relatedArticles.forEach(r => {
                                if (!this.readStates.has(r.link)) {
                                    linksToMark.push(r.link);
                                }
                            });
                        }
                    });
                    
                    linksToMark = [...new Set(linksToMark)]; // deduplicate
                    if (linksToMark.length === 0) return;

                    if (this.markAllUndoTimer) clearTimeout(this.markAllUndoTimer);
                    this.markAllUndo = {
                        links: [...linksToMark],
                        unreadCounts: JSON.parse(JSON.stringify(this.unreadCounts))
                    };
                    this.markAllUndoTimer = setTimeout(() => {
                        this.markAllUndo = null;
                        this.markAllUndoTimer = null;
                    }, 15000);

                    linksToMark.forEach(link => { this.pendingUnreadLinks.delete(link); this.pendingReadLinks.add(link); });
                    this.readStates = new Set([...this.readStates, ...linksToMark]);
                    
                    unreadInView.forEach(article => {
                        if (this.unreadCounts.total > 0) this.unreadCounts.total--;
                        if (this.unreadCounts.feeds[article.feedUrl] > 0) this.unreadCounts.feeds[article.feedUrl]--;
                        let cat = article.feedCategory || 'Others';
                        if (this.unreadCounts.categories[cat] > 0) this.unreadCounts.categories[cat]--;
                    });

                    if (typeof this.saveState === 'function') this.saveState();

                    try {
                        const response = await fetch('/api/toggle-batch', {
                            method: 'POST', keepalive: true,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ links: linksToMark, list: 'readStates', forceAdd: true })
                        });
                        if (response.ok) linksToMark.forEach(link => this.pendingReadLinks.delete(link));
                    } catch (_) { /* pendingReadLinks retries later */ }
                    if (typeof this.saveState === 'function') this.saveState();
                },

                async undoMarkAllRead() {
                    if (!this.markAllUndo) return;
                    const undo = this.markAllUndo;
                    if (this.markAllUndoTimer) clearTimeout(this.markAllUndoTimer);
                    this.markAllUndo = null;
                    this.markAllUndoTimer = null;
                    const links = new Set(undo.links);
                    undo.links.forEach(link => { this.pendingReadLinks.delete(link); this.pendingUnreadLinks.add(link); });
                    this.readStates = new Set([...this.readStates].filter(link => !links.has(link)));
                    this.unreadCounts = JSON.parse(JSON.stringify(undo.unreadCounts));
                    if (typeof this.saveState === 'function') this.saveState();
                    try {
                        const response = await fetch('/api/toggle-batch', {
                            method: 'POST', keepalive: true,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ links: undo.links, list: 'readStates', forceRemove: true })
                        });
                        if (response.ok) undo.links.forEach(link => this.pendingUnreadLinks.delete(link));
                    } catch (_) { /* pendingUnreadLinks retries later */ }
                    if (typeof this.saveState === 'function') this.saveState();
                },

                async fetchUniversalUserStateSnapshot() {
                    if (!this.isLoggedIn) return null;
                    try {
                        const res = await fetch('/api/user-states', { cache: 'no-store' });
                        if (!res.ok) return null;
                        return await res.json();
                    } catch {
                        return null;
                    }
                },

                async recordRecentlyRead(link) {
                    const normalized = this.normalizeStateLink(link);
                    if (!normalized) return;
                    this.recentReadAt = { ...this.recentReadAt, [normalized]: Date.now() };
                    this.pendingRecentReadLinks.add(normalized);
                    if (typeof this.saveState === 'function') this.saveState();
                    try {
                        const res = await fetch('/api/recently-read', {
                            method: 'POST', keepalive: true,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ link: normalized })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data?.link && data?.at) this.recentReadAt = { ...this.recentReadAt, [data.link]: Number(data.at) };
                            this.pendingRecentReadLinks.delete(normalized);
                        }
                    } catch (_) { /* Retry during the next universal-state reconciliation. */ }
                },

                async syncUserStatesInBackground() {
                    if (!this.isLoggedIn) return;
                    try {
                        await this.flushUserPreferences();
                        await this.flushPendingStateMutations();
                        for (const link of [...this.pendingRecentReadLinks]) {
                            try {
                                const recentResponse = await fetch('/api/recently-read', {
                                    method: 'POST', keepalive: true,
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ link })
                                });
                                if (recentResponse.ok) {
                                    const recent = await recentResponse.json();
                                    if (recent?.link && recent?.at) this.recentReadAt = { ...this.recentReadAt, [recent.link]: Number(recent.at) };
                                    this.pendingRecentReadLinks.delete(link);
                                }
                            } catch (_) {}
                        }
                        const pending = [...this.pendingReadLinks];
                        if (pending.length) {
                            const saved = await fetch('/api/toggle-batch', {
                                method: 'POST', keepalive: true,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ links: pending, list: 'readStates', forceAdd: true })
                            });
                            if (saved.ok) pending.forEach(link => this.pendingReadLinks.delete(link));
                        }
                        const pendingUnread = [...this.pendingUnreadLinks];
                        if (pendingUnread.length) {
                            const removed = await fetch('/api/toggle-batch', {
                                method: 'POST', keepalive: true,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ links: pendingUnread, list: 'readStates', forceRemove: true })
                            });
                            if (removed.ok) pendingUnread.forEach(link => this.pendingUnreadLinks.delete(link));
                        }
                        const res = await fetch('/api/user-states', { cache: 'no-store' });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.readStates) this.readStates = new Set([...data.readStates, ...this.pendingReadLinks].filter(link => !this.pendingUnreadLinks.has(link)));
                            if (data.recentReadAt) {
                                const localPending = Object.fromEntries([...this.pendingRecentReadLinks].map(link => [link, this.recentReadAt[link] || Date.now()]));
                                this.recentReadAt = { ...data.recentReadAt, ...localPending };
                            }
                            if (data.savedStates) this.savedStates = this.applyPendingStateMutations('savedStates', data.savedStates);
                            if (data.boardStates) this.boardStates = this.applyPendingStateMutations('boardStates', data.boardStates);
                            if (data.hiddenStates) this.hiddenStates = this.applyPendingStateMutations('hiddenStates', data.hiddenStates);
                            if (data.userPreferences) this.userPreferences = { ...data.userPreferences, ...this.pendingPreferences };
                            if (data.clusteringModel) this.clusteringModel = data.clusteringModel;
                            
                            // State sync updates badges and actions only. Removing cards here made
                            // the feed jump after returning from the reader or another browser tab.
                            // Membership is refreshed only by an explicit feed request.
                        }
                    } catch (e) {
                        console.error('Failed to background sync user states:', e);
                    }
                },
        };
    }
};

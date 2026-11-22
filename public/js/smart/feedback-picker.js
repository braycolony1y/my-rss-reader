// "Not interested" popup for Stories. It suggests keywords typical of the story (computed on the
// server, no AI), lets the reader type their own, and adds the chosen ones to Content filters
// (blockedArticleKeywords). With nothing chosen it hides just this story, as the Hide button does.
const ReaderSmartFeedback = {
    suggestionTimeoutMs: 12000,
    toastMs: 12000,
    maxKeywords: 12,
    maxKeywordLength: 80,
    fields: ['title', 'subtitle', 'subheadline', 'description', 'excerpt', 'summary', 'contentSnippet', 'content'],
    // Mirror normalizeBlockedText on the server, including one pass of HTML entity decoding.
    plain(value) {
        let text = String(value || '').replace(/<[^>]+>/g, ' ');
        if (text.includes('&')) {
            const decoder = ReaderSmartFeedback.entityDecoder ??= document.createElement('textarea');
            // Pass only character references to the HTML parser, so all other text stays literal.
            text = text.replace(/&(?:#[xX][\da-fA-F]+;?|#\d+;?|[a-zA-Z][a-zA-Z\d]*;?)/g, reference => {
                decoder.innerHTML = reference;
                return decoder.textContent;
            });
        }
        return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    },
    keyword(value) {
        return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN').slice(0, ReaderSmartFeedback.maxKeywordLength);
    },
    texts: new WeakMap(),
    textsOf(article) {
        const values = ReaderSmartFeedback.fields.map(field => article[field]);
        let cached = ReaderSmartFeedback.texts.get(article);
        if (!cached || values.some((value, index) => value !== cached.values[index])) {
            cached = { values, texts: values.map(ReaderSmartFeedback.plain).filter(Boolean) };
            ReaderSmartFeedback.texts.set(article, cached);
        }
        return cached.texts;
    },
    matches(article, keywords) {
        return !!keywords.length && ReaderSmartFeedback.textsOf(article).some(text => keywords.some(keyword => text.includes(keyword)));
    },
    storyHidden(article, keywords) {
        if (!article || !keywords.length) return false;
        const leadTexts = article.contentFilterLeadTexts;
        if (!leadTexts) return ReaderSmartFeedback.matches(article, keywords);
        if (leadTexts.some(text => keywords.some(keyword => text.includes(keyword)))) return true;
        // A manual hide has already removed the stored lead from this card.
        return ReaderSmartFeedback.matches(article, keywords)
            && (article.relatedArticles || []).every(member => ReaderSmartFeedback.matches(member, keywords));
    },

    create() {
        let suggestionRequest = null, toastTimer = null;
        return {
            feedbackSession: null, feedbackBusy: false, feedbackMessage: '', feedbackToast: null,
            feedbackHiddenLinks: [], feedbackHiddenKeywords: [], feedbackPosition: '', feedbackReturnFocus: null,

            openSmartFeedback(article, event) {
                if (this.selectedFilterType !== 'smart') return;
                this.cancelSmartFeedback();
                this.feedbackReturnFocus = event?.currentTarget;
                const bounds = event?.currentTarget?.getBoundingClientRect();
                const left = Math.max(12, Math.min(window.innerWidth - 452, (bounds?.right || window.innerWidth / 2) - 430));
                const top = Math.max(12, Math.min(window.innerHeight - 560, (bounds?.bottom || 90) + 8));
                this.feedbackPosition = `left:${left}px;top:${top}px`;
                this.feedbackSession = { token: crypto.randomUUID(), article, chips: [], input: '', loading: true, failed: false };
                this.feedbackMessage = '';
                this.$nextTick(() => document.querySelector('#smart-feedback-picker .feedback-input')?.focus());
                this.loadFeedbackSuggestions(this.feedbackSession);
            },
            async loadFeedbackSuggestions(session) {
                const controller = new AbortController();
                suggestionRequest?.abort();
                suggestionRequest = controller;
                const timer = setTimeout(() => controller.abort(), ReaderSmartFeedback.suggestionTimeoutMs);
                try {
                    const { link, originalLink, clusterId } = session.article;
                    const query = new URLSearchParams({ link: link || '' });
                    if (clusterId) query.set('clusterId', clusterId);
                    if (originalLink && originalLink !== link) query.set('originalLink', originalLink);
                    const response = await fetch('/api/content-filters/suggest?' + query, { signal: controller.signal, cache: 'no-store' });
                    if (!response.ok) throw new Error('Could not load suggestions.');
                    const data = await response.json();
                    if (this.feedbackSession?.token !== session.token) return;
                    const known = new Set(session.chips.map(chip => chip.keyword));
                    const suggested = (data.suggestions || []).map(item => ReaderSmartFeedback.keyword(item.keyword)).filter(keyword => keyword && !known.has(keyword));
                    session.chips = [...suggested.map(keyword => ({ keyword, typed: false, selected: false })), ...session.chips];
                    if (!suggested.length && !session.chips.length) this.feedbackMessage = 'No suggestions for this story. Type your own words below.';
                } catch (error) {
                    if (this.feedbackSession?.token === session.token) {
                        session.failed = true;
                        this.feedbackMessage = 'Could not load suggestions. You can still type your own words below.';
                    }
                } finally {
                    clearTimeout(timer);
                    if (suggestionRequest === controller) suggestionRequest = null;
                    if (this.feedbackSession?.token === session.token) session.loading = false;
                }
            },
            cancelSmartFeedback() {
                if (this.feedbackBusy === 'apply') return;
                suggestionRequest?.abort();
                suggestionRequest = null;
                this.feedbackSession = null;
                this.feedbackBusy = false;
                this.feedbackMessage = '';
                this.feedbackReturnFocus?.focus?.();
                this.feedbackReturnFocus = null;
            },
            feedbackContextChanged() {
                if (this.feedbackSession) this.cancelSmartFeedback();
            },
            toggleFeedbackChip(chip) {
                if (this.feedbackBusy) return;
                chip.selected = !chip.selected;
                this.feedbackMessage = '';
            },
            // Turns typed text (comma separated) into selected chips. Returns how many were added or re-selected.
            addFeedbackInput() {
                const session = this.feedbackSession;
                if (!session || this.feedbackBusy) return 0;
                let count = 0;
                for (const part of String(session.input || '').split(',')) {
                    const keyword = ReaderSmartFeedback.keyword(part);
                    if (!keyword) continue;
                    const existing = session.chips.find(chip => chip.keyword === keyword);
                    if (existing) { existing.selected = true; count++; continue; }
                    if (session.chips.filter(chip => chip.typed).length >= ReaderSmartFeedback.maxKeywords) {
                        this.feedbackMessage = `You can add up to ${ReaderSmartFeedback.maxKeywords} words at a time.`;
                        break;
                    }
                    session.chips.push({ keyword, typed: true, selected: true });
                    count++;
                }
                session.input = '';
                if (count) this.feedbackMessage = '';
                return count;
            },
            onFeedbackInputKeydown(event) {
                if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    this.addFeedbackInput();
                }
            },
            removeFeedbackChip(chip) {
                const session = this.feedbackSession;
                if (session && !this.feedbackBusy) session.chips = session.chips.filter(item => item !== chip);
            },
            get feedbackKeywords() {
                const session = this.feedbackSession;
                if (!session) return [];
                const chosen = session.chips.filter(chip => chip.selected).map(chip => chip.keyword);
                // Text typed but not yet added still counts when the reader confirms.
                for (const part of String(session.input || '').split(',')) {
                    const keyword = ReaderSmartFeedback.keyword(part);
                    if (keyword && !chosen.includes(keyword)) chosen.push(keyword);
                }
                return chosen;
            },
            get feedbackPreviewText() {
                const keywords = this.feedbackKeywords.map(ReaderSmartFeedback.plain).filter(Boolean);
                if (!keywords.length) return '';
                let hiddenStories = 0, partialStories = 0, hiddenMembers = 0;
                for (const article of this.articles || []) {
                    if (this.isSmartFeedbackHidden(article)) continue;
                    if (ReaderSmartFeedback.storyHidden(article, keywords)) {
                        hiddenStories++;
                        continue;
                    }
                    const related = Array.isArray(article.relatedArticles) ? article.relatedArticles : [];
                    const members = article.contentFilterLeadTexts ? [article, ...related] : related;
                    const matches = members.filter(member => member && ReaderSmartFeedback.matches(member, keywords)).length;
                    if (matches) {
                        partialStories++;
                        hiddenMembers += matches;
                    }
                }
                const full = `${hiddenStories} ${hiddenStories === 1 ? 'story' : 'stories'} in view would be hidden`;
                if (!partialStories) return full;
                const articles = `${hiddenMembers} matching ${hiddenMembers === 1 ? 'article' : 'articles'}`;
                const stories = partialStories === 1 ? 'a story' : `${partialStories} stories`;
                return `${full}. ${articles} would be removed from ${stories} with other coverage.`;
            },
            get feedbackConfirmLabel() {
                return this.feedbackKeywords.length ? 'Apply content filters' : 'Hide this story';
            },

            async feedbackKeywordList(method = 'GET', keywords) {
                const response = await fetch('/api/content-filter-settings', method === 'GET'
                    ? { cache: 'no-store' }
                    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords }) });
                if (!response.ok) throw new Error('Could not update Content filters. Please try again.');
                return (await response.json()).keywords || [];
            },
            applyFeedbackKeywordList(keywords) {
                this.blockedKeywords = this.normalizeKeywordList(keywords);
                if (!this.contentFilterSettingsOpen) this.blockedKeywordsDraft = [...this.blockedKeywords];
            },
            // True once a fresh, already filtered list has replaced the one on screen.
            async refreshAfterFeedbackChange() {
                try {
                    const result = await this.fetchData();
                    return result?.ok === true;
                } catch { return false; }
            },
            showFeedbackToast(toast) {
                clearTimeout(toastTimer);
                this.feedbackToast = toast;
                const activeToast = this.feedbackToast;
                toastTimer = setTimeout(() => { if (this.feedbackToast === activeToast) this.feedbackToast = null; }, ReaderSmartFeedback.toastMs);
            },
            dismissFeedbackToast() {
                clearTimeout(toastTimer);
                this.feedbackToast = null;
            },
            async confirmSmartFeedback() {
                const session = this.feedbackSession;
                if (!session || this.feedbackBusy) return;
                this.addFeedbackInput();
                const keywords = this.feedbackKeywords;
                const article = session.article;
                this.feedbackBusy = 'apply';
                try {
                    if (!keywords.length) {
                        // Default action: hide only this story.
                        if (!this.hasArticleState('hiddenStates', article)) await this.toggleState('hiddenStates', article);
                        this.feedbackHiddenLinks = [...this.feedbackHiddenLinks, article.link];
                        this.feedbackBusy = false;
                        this.cancelSmartFeedback();
                        this.showFeedbackToast({ kind: 'story', article: { link: article.link, originalLink: article.originalLink }, message: 'Story hidden.' });
                        return;
                    }
                    const current = await this.feedbackKeywordList();
                    const existing = new Set(this.normalizeKeywordList(current));
                    const added = [...new Set(keywords)].filter(keyword => !existing.has(this.normalizeKeywordPhrase(keyword)));
                    if (added.length) this.applyFeedbackKeywordList(await this.feedbackKeywordList('POST', [...current, ...added]));
                    this.feedbackHiddenKeywords = [...this.feedbackHiddenKeywords, ...keywords.map(ReaderSmartFeedback.plain).filter(Boolean)];
                    this.feedbackBusy = false;
                    this.cancelSmartFeedback();
                    const quoted = keywords.map(keyword => `“${keyword}”`).join(', ');
                    this.showFeedbackToast({ kind: 'keywords', added, message: added.length ? `Content filters applied for ${quoted}.` : `Already in Content filters: ${quoted}.` });
                    if (!added.length || await this.refreshAfterFeedbackChange()) this.feedbackHiddenKeywords = [];
                } catch (error) {
                    this.feedbackBusy = false;
                    this.feedbackMessage = error.message || 'Could not save. Please try again.';
                }
            },
            async undoSmartFeedback() {
                const toast = this.feedbackToast;
                if (!toast || this.feedbackBusy) return;
                this.feedbackBusy = 'undo';
                try {
                    if (toast.kind === 'story') {
                        if (this.hasArticleState('hiddenStates', toast.article)) await this.toggleState('hiddenStates', toast.article);
                        this.feedbackHiddenLinks = this.feedbackHiddenLinks.filter(link => link !== toast.article.link);
                    } else {
                        // Remove only the entries this action added; other edits made meanwhile stay.
                        const remove = new Set((toast.added || []).map(keyword => this.normalizeKeywordPhrase(keyword)));
                        const current = await this.feedbackKeywordList();
                        if (remove.size) this.applyFeedbackKeywordList(await this.feedbackKeywordList('POST', current.filter(keyword => !remove.has(this.normalizeKeywordPhrase(keyword)))));
                        this.feedbackHiddenKeywords = [];
                        await this.refreshAfterFeedbackChange();
                    }
                    this.dismissFeedbackToast();
                } catch (error) {
                    this.feedbackMessage = error.message || 'Could not undo. Please try again.';
                } finally { this.feedbackBusy = false; }
            },
            manageContentFilters() {
                this.dismissFeedbackToast();
                this.openContentFilterSettings();
            },
            // Cards hidden right away, before the server's filtered list arrives.
            isSmartFeedbackHidden(article) {
                if (this.selectedFilterType !== 'smart') return false;
                if (this.feedbackHiddenLinks.includes(article.link)) return true;
                return ReaderSmartFeedback.storyHidden(article, this.feedbackHiddenKeywords);
            },
            trapFeedbackFocus(event) {
                const panel = event.currentTarget;
                if (event.key !== 'Tab') return;
                const nodes = [...panel.querySelectorAll('button:not([disabled]),input,textarea,a[href]')].filter(node => node.getClientRects().length);
                if (!nodes.length) return;
                if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
                else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
            },
        };
    }
};

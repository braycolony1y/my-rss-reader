// Owns feeds / content-filter on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderFeedsContentFilter = {
    create() {
        return {
                contentFilterSettingsOpen: false,
                blockedKeywords: [],
                blockedKeywordsDraft: [],
                savingContentFilter: false,
                contentFilterLoaded: false,
                contentFilterLoading: false,
                contentFilterLoadPromise: null,
                contentFilterError: '',
                contentFilterPreview: [],
                contentFilterPreviewTotal: 0,
                contentFilterPreviewKeyword: '',
                contentFilterPreviewKeywordTotals: [],
                contentFilterPreviewLoading: false,
                contentFilterPreviewError: '',
                contentFilterPreviewRequest: 0,
                contentFilterPreviewDebounce: null,

                async fetchContentFilterSettings() {
                    if (this.contentFilterLoadPromise) return this.contentFilterLoadPromise;
                    if (this.savingContentFilter) return;
                    this.contentFilterLoading = true;
                    this.contentFilterError = '';
                    const draftBeforeLoad = JSON.stringify(this.blockedKeywordsDraft);
                    this.contentFilterLoadPromise = (async () => {
                        try {
                            const response = await fetch('/api/content-filter-settings', { cache: 'no-store' });
                            if (!response.ok) throw new Error('Could not load saved filters. Reopen Content filters to retry.');
                            const data = await response.json();
                            this.blockedKeywords = this.normalizeKeywordList(data.keywords || []);
                            this.contentFilterLoaded = true;
                            if (!this.contentFilterSettingsOpen || JSON.stringify(this.blockedKeywordsDraft) === draftBeforeLoad) {
                                this.blockedKeywordsDraft = [...this.blockedKeywords];
                            }
                        } catch (error) {
                            this.contentFilterError = error.message;
                        } finally {
                            this.contentFilterLoading = false;
                            this.contentFilterLoadPromise = null;
                        }
                    })();
                    return this.contentFilterLoadPromise;
                },

                openContentFilterSettings() {
                    this.blockedKeywordsDraft = [...this.blockedKeywords];
                    this.contentFilterSettingsOpen = true;
                    this.mobileSidebarOpen = false;
                    if (!this.contentFilterLoaded) void this.fetchContentFilterSettings();

                    clearTimeout(this.contentFilterPreviewDebounce);
                    this.contentFilterPreviewDebounce = null;

                    // Obsolete any preview request already in flight.
                    this.contentFilterPreviewRequest++;

                    this.contentFilterPreview = [];
                    this.contentFilterPreviewTotal = 0;
                    this.contentFilterPreviewKeywordTotals = [];
                    this.contentFilterPreviewKeyword = '';
                    this.contentFilterPreviewError = '';
                    this.contentFilterPreviewLoading = false;
                },

                draftBlockedKeywords() {
                    return this.normalizeKeywordList(this.blockedKeywordsDraft);
                },

                scheduleContentFilterPreview(keyword = '') {
                    const keywords = this.draftBlockedKeywords();
                    const normalized = this.normalizeKeywordPhrase(keyword);

                    this.contentFilterPreviewKeyword =
                        normalized && keywords.includes(normalized)
                            ? normalized
                            : (keywords[keywords.length - 1] || '');

                    /*
                     * Do not automatically scan articles after editing.
                     * Add/edit/remove operations remain entirely local.
                     */
                    clearTimeout(this.contentFilterPreviewDebounce);
                    this.contentFilterPreviewDebounce = null;

                    // Cancel/obsolete previous async preview responses.
                    this.contentFilterPreviewRequest++;

                    this.contentFilterPreview = [];
                    this.contentFilterPreviewTotal = 0;
                    this.contentFilterPreviewKeywordTotals = [];
                    this.contentFilterPreviewError = '';
                    this.contentFilterPreviewLoading = false;
                },

                addContentFilterKeyword(input) {
                    // CONTENT_FILTER_KEYWORD_UI_V4
                    const value =
                        this.normalizeKeywordPhrase(
                            input.value
                        );

                    /*
                     * Enter followed by blur can call this twice.
                     * Empty input means the phrase was already committed.
                     */
                    if (!value) {
                        return;
                    }

                    this.blockedKeywordsDraft =
                        this.normalizeKeywordList(
                            this.blockedKeywordsDraft
                        );

                    if (
                        !this.blockedKeywordsDraft.includes(
                            value
                        )
                    ) {
                        this.blockedKeywordsDraft.push(
                            value
                        );
                    }

                    input.value = '';

                    /*
                     * User finished entering the phrase:
                     * select/highlight it and immediately preview it.
                     */
                    this.scheduleContentFilterPreview(
                        value
                    );

                    this.fetchContentFilterPreview();
                },

                editContentFilterKeyword(index, input) {
                    const value =
                        this.normalizeKeywordPhrase(
                            input.value
                        );

                    if (value) {
                        this.blockedKeywordsDraft.splice(
                            index,
                            1,
                            value
                        );
                    } else {
                        this.blockedKeywordsDraft.splice(
                            index,
                            1
                        );
                    }

                    this.blockedKeywordsDraft =
                        this.normalizeKeywordList(
                            this.blockedKeywordsDraft
                        );

                    if (value) {
                        /*
                         * Editing finished. Select the edited phrase and
                         * automatically update its affected-article preview.
                         */
                        this.scheduleContentFilterPreview(
                            value
                        );

                        this.fetchContentFilterPreview();
                    } else {
                        this.scheduleContentFilterPreview();
                    }
                },

                removeContentFilterKeyword(index) {
                    this.blockedKeywordsDraft.splice(index, 1);
                    this.blockedKeywordsDraft = this.normalizeKeywordList(this.blockedKeywordsDraft);
                    this.scheduleContentFilterPreview();
                },

                contentFilterPreviewCount(keyword) {
                    return this.contentFilterPreviewKeywordTotals.find(item => item.keyword === keyword)?.total || 0;
                },

                selectContentFilterPreviewKeyword(keyword) {
                    const normalized =
                        this.normalizeKeywordPhrase(
                            keyword
                        );

                    if (!normalized) {
                        return;
                    }

                    /*
                     * Always check on click, even when this phrase was
                     * already selected. This also acts as manual refresh.
                     */
                    this.contentFilterPreviewKeyword =
                        normalized;

                    this.fetchContentFilterPreview();
                },

                async fetchContentFilterPreview(append = false) {
                    if (append && this.contentFilterPreviewLoading) return;
                    const keywords = this.draftBlockedKeywords();
                    const requestId = ++this.contentFilterPreviewRequest;
                    if (!keywords.length) {
                        this.contentFilterPreview = [];
                        this.contentFilterPreviewTotal = 0;
                        this.contentFilterPreviewKeyword = '';
                        this.contentFilterPreviewKeywordTotals = [];
                        this.contentFilterPreviewError = '';
                        this.contentFilterPreviewLoading = false;
                        return;
                    }
                    if (!keywords.includes(this.contentFilterPreviewKeyword)) this.contentFilterPreviewKeyword = keywords[keywords.length - 1];
                    const offset = append ? this.contentFilterPreview.length : 0;
                    if (!append) {
                        this.contentFilterPreview = [];
                        this.contentFilterPreviewTotal = 0;
                    }
                    this.contentFilterPreviewLoading = true;
                    this.contentFilterPreviewError = '';
                    try {
                        const response = await fetch('/api/content-filter-preview', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ keywords, selectedKeyword: this.contentFilterPreviewKeyword, offset, limit: 50 })
                        });
                        if (!response.ok) throw new Error('Could not check affected articles');
                        const data = await response.json();
                        if (requestId !== this.contentFilterPreviewRequest) return;
                        const matches = Array.isArray(data.matches) ? data.matches : [];
                        this.contentFilterPreview = append ? [...this.contentFilterPreview, ...matches] : matches;
                        this.contentFilterPreviewTotal = Number(data.total) || 0;
                        this.contentFilterPreviewKeyword = data.selectedKeyword || this.contentFilterPreviewKeyword;
                        this.contentFilterPreviewKeywordTotals = Array.isArray(data.keywordTotals) ? data.keywordTotals : [];
                    } catch (error) {
                        if (requestId === this.contentFilterPreviewRequest) this.contentFilterPreviewError = error.message;
                    } finally {
                        if (requestId === this.contentFilterPreviewRequest) this.contentFilterPreviewLoading = false;
                    }
                },

                async saveContentFilterSettings() {
                    if (this.savingContentFilter || this.contentFilterLoading || !this.contentFilterLoaded) return;
                    const keywords = this.draftBlockedKeywords();
                    this.savingContentFilter = true;
                    this.contentFilterError = '';
                    clearTimeout(this.contentFilterPreviewDebounce);
                    this.contentFilterPreviewRequest++;
                    try {
                        const response = await fetch('/api/content-filter-settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ keywords }),
                            keepalive: true
                        });
                        if (!response.ok) throw new Error('Could not save filters. Your changes are still here; please retry.');
                        const data = await response.json();
                        this.blockedKeywords = this.normalizeKeywordList(data.keywords);
                        this.blockedKeywordsDraft = [...this.blockedKeywords];
                        this.contentFilterSettingsOpen = false;
                        void this.fetchData(false, false, true);
                    } catch (error) {
                        this.contentFilterError = error.message;
                        this.contentFilterSettingsOpen = true;
                    } finally {
                        this.savingContentFilter = false;
                    }
                },
        };
    }
};

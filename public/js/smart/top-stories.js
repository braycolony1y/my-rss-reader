// Owns smart / top-stories on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderSmartTopStories = {
    create() {
        return {
                topStories: [],
                topUpdatesAvailable: false,
                ...ArticlePanels.createState(),
                storyCoverageOpen: {},
                async refreshTopStories() {
                    this.smartViewToken = '';
                    this.resetStoryPanels();
                    this.topUpdatesAvailable = false;
                    await this.fetchData();
                },
                storyExcerpt(article) {
                    return (this.briefingFor(article).sections || []).find(s => s.label === 'What happened')?.text || this.stripHtml(article.content);
                },
                storyAnalysis(article) {
                    const briefing = this.briefingFor(article);
                    if (briefing.analysisStatus !== 'evaluated') return [];

                    const sections = (briefing.sections || [])
                        .filter(section =>
                            section.label !== 'What happened' &&
                            section.text?.trim()
                        );

                    const rawTimeline =
                        article.topStory?.timeline || [];

                    const selectedTimelineIds =
                        new Set(
                            Array.isArray(
                                briefing.timelineEntryIds
                            )
                                ? briefing.timelineEntryIds
                                    .map(id => String(id))
                                : []
                        );

                    const timeline =
                        rawTimeline.filter(event =>
                            selectedTimelineIds.has(
                                String(event?.id ?? '')
                            )
                        );

                    const timelineReview =
                        briefing.analysisReview?.find(
                            section =>
                                section.label === 'Timeline'
                        );

                    const useTimeline =
                        timelineReview?.useful === true &&
                        timeline.length > 1;

                    const byLabel = new Map(
                        sections.map(section => [
                            section.label,
                            section
                        ])
                    );

                    if (
                        useTimeline &&
                        timeline.length > 1 &&
                        !byLabel.has('Timeline') &&
                        !article.topStory?.conflicts?.length
                    ) {
                        byLabel.set('Timeline', {
                            label: 'Timeline',
                            text: '',
                            timeline
                        });
                    }

                    return [...byLabel.values()];
                },

                storyAnalysisByLabel(article, label) {
                    return this.storyAnalysis(article)
                        .find(section => section.label === label) || null;
                },

                storyPrimaryAnalysis(article) {
                    const preferred = [
                        'Why it matters',
                        'What changed',
                        'What to watch'
                    ];

                    return preferred
                        .map(label =>
                            this.storyAnalysisByLabel(article, label)
                        )
                        .filter(Boolean);
                },

                storyExtraAnalysis(article) {
                    const primary = new Set([
                        'Why it matters',
                        'What changed',
                        'What to watch'
                    ]);

                    return this.storyAnalysis(article)
                        .filter(section => !primary.has(section.label));
                },

                storyAnalysisOrdered(article) {
                    return [
                        ...this.storyPrimaryAnalysis(article),
                        ...this.storyExtraAnalysis(article)
                    ];
                },

                activeStoryAnalysisLabel(article) {
                    const id =
                        article.clusterId ||
                        article.link;

                    const sections =
                        this.storyAnalysisOrdered(article);

                    if (!sections.length) return null;

                    const selected =
                        this.storyAnalysisOpen[id];

                    if (
                        selected &&
                        sections.some(
                            section => section.label === selected
                        )
                    ) {
                        return selected;
                    }

                    return sections[0].label;
                },

                activeStoryAnalysisSection(article) {
                    const label =
                        this.activeStoryAnalysisLabel(article);

                    return label
                        ? this.storyAnalysis(article)
                            .find(section => section.label === label) || null
                        : null;
                },

                storyMoreAnalysisActive(article) {
                    const active =
                        this.activeStoryAnalysisLabel(article);

                    return this.storyExtraAnalysis(article)
                        .some(section => section.label === active);
                },

                openMoreStoryAnalysis(article) {
                    const extra =
                        this.storyExtraAnalysis(article);

                    if (!extra.length) return;

                    const active =
                        this.activeStoryAnalysisLabel(article);

                    const selected =
                        extra.some(section => section.label === active)
                            ? active
                            : extra[0].label;

                    this.toggleStoryAnalysis(
                        article,
                        selected
                    );
                },

                advanceStoryAnalysis(article) {
                    const sections =
                        this.storyAnalysisOrdered(article);

                    if (sections.length < 2) return;

                    const current =
                        this.activeStoryAnalysisLabel(article);

                    const currentIndex =
                        Math.max(
                            0,
                            sections.findIndex(
                                section =>
                                    section.label === current
                            )
                        );

                    const next =
                        sections[
                            (currentIndex + 1) %
                            sections.length
                        ];

                    if (next) {
                        this.toggleStoryAnalysis(
                            article,
                            next.label
                        );
                    }
                },

                storyKeyFactParts(value) {
                    const text =
                        this.stripHtml(
                            typeof value === 'string'
                                ? value
                                : value?.text || ''
                        )
                        .replace(/\s+/g, ' ')
                        .trim();

                    if (!text) {
                        return {
                            value: '',
                            label: ''
                        };
                    }

                    const words = text.split(' ');

                    if (words.length === 1) {
                        return {
                            value: words[0],
                            label: ''
                        };
                    }

                    let cut = 2;

                    // 188 drones launched
                    // +30% battery life
                    // 48MP main camera
                    if (/^[+\-−]?\d/i.test(words[0])) {
                        cut = 1;
                    }

                    // A19 Pro new chip
                    else if (
                        /^[A-Za-z]{1,6}\d/i.test(words[0]) &&
                        words[1] &&
                        /^(?:pro|max|ultra|plus|mini)$/i.test(words[1])
                    ) {
                        cut = 2;
                    }

                    else {
                        cut = Math.min(
                            2,
                            words.length - 1
                        );
                    }

                    return {
                        value:
                            words.slice(0, cut).join(' '),
                        label:
                            words.slice(cut).join(' ')
                    };
                },

                storyKeyFactIcon(value) {
                    const text =
                        this.stripHtml(
                            typeof value === 'string'
                                ? value
                                : value?.text || ''
                        ).toLowerCase();

                    if (
                        /battery|pin\b|mah\b/.test(text)
                    ) return '▰';

                    if (
                        /camera|photo|ảnh|mp\b/.test(text)
                    ) return '◉';

                    if (
                        /chip|processor|cpu|gpu|soc\b/.test(text)
                    ) return '▣';

                    if (
                        /drone|missile|rocket|tên lửa|máy bay/.test(text)
                    ) return '✦';

                    if (
                        /power|electric|outage|điện/.test(text)
                    ) return 'ϟ';

                    if (
                        /defen|security|intercept|phòng không|an ninh/.test(text)
                    ) return '◆';

                    if (
                        /cvss|critical|vulnerab|exploit|lỗ hổng|nghiêm trọng/.test(text)
                    ) return '▲';

                    if (
                        /rain|rainfall|mưa/.test(text)
                    ) return '☂︎';

                    if (
                        /wind|km\/h|mph|gió/.test(text)
                    ) return '≋';

                    if (
                        /hurricane|typhoon|cyclone|storm|category|bão/.test(text)
                    ) return '◉';

                    if (
                        /revenue|profit|earnings|guidance|sales|doanh thu|lợi nhuận/.test(text)
                    ) return '↗';

                    if (
                        /export|import|xuất khẩu|nhập khẩu/.test(text)
                    ) return '▰';

                    if (
                        /stock|shares|ticker|aapl|msft|nvda|cổ phiếu/.test(text)
                    ) return '▥';

                    if (
                        /growth|yoy|qoq|tăng trưởng/.test(text)
                    ) return '▥';

                    if (
                        /people|person|region|city|người|khu vực|thành phố/.test(text)
                    ) return '●';

                    return '✦';
                },

                storyKeyFacts(article) {
                    return (
                        this.briefingFor(article).keyFacts ||
                        []
                    )
                    .slice(0, 4)
                    .map((fact, index) => {
                        const structured =
                            fact &&
                            typeof fact === 'object';

                        const explicitValue =
                            structured
                                ? this.stripHtml(
                                    fact.value || ''
                                )
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                : '';

                        const explicitLabel =
                            structured
                                ? this.stripHtml(
                                    fact.label || ''
                                )
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                : '';

                        const legacyText =
                            typeof fact === 'string'
                                ? fact
                                : fact?.text || '';

                        const text =
                            (
                                explicitValue ||
                                explicitLabel
                            )
                                ? `${explicitValue} ${explicitLabel}`.trim()
                                : legacyText;

                        const parts =
                            explicitValue
                                ? {
                                    value: explicitValue,
                                    label: explicitLabel
                                }
                                : this.storyKeyFactParts(
                                    legacyText
                                );

                        return {
                            id:
                                `${index}:${text}`,
                            text,
                            value:
                                parts.value,
                            label:
                                parts.label,
                            icon:
                                (
                                    typeof fact === 'object' &&
                                    fact?.icon
                                )
                                    ? fact.icon
                                    : '✦'
                        };
                    })
                    .filter(
                        fact =>
                            fact.value ||
                            fact.label
                    );
                },

                storyAnalysisDisplayLabel(article, label) {
                    const vietnamese =
                        article?.topStory?.feed
                            ?.endsWith('_vietnam');

                    if (!vietnamese) return label;

                    const labels = {
                        'What happened': 'Chuyện gì xảy ra',
                        'Timeline': 'Diễn biến',
                        'Why it matters': 'Vì sao quan trọng',
                        'What changed': 'Có gì thay đổi',
                        'Market impact': 'Tác động thị trường',
                        'Crypto impact': 'Tác động crypto',
                        'Industry implication': 'Tác động ngành',
                        'Implication for Vietnam': 'Tác động với Việt Nam',
                        'Strategic implication': 'Hàm ý chiến lược',
                        'Who is affected': 'Ai bị ảnh hưởng',
                        'What to do': 'Nên làm gì',
                        'What to watch': 'Cần theo dõi',
                        'Background / Context': 'Bối cảnh',
                        'Context / implications': 'Bối cảnh / hàm ý',
                        'Takeaway': 'Điểm chính'
                    };

                    return labels[label] || label;
                },

                storyMoreAnalysisLabel(article, count) {
                    const vietnamese =
                        article?.topStory?.feed
                            ?.endsWith('_vietnam');

                    return vietnamese
                        ? `Phân tích thêm (${count})`
                        : `More analysis (${count})`;
                },

                storyAnalysisNotice(article) {
                    const briefing =
                        this.briefingFor(article);

                    const vietnamese =
                        article.topStory?.feed
                            ?.endsWith('_vietnam');

                    if (
                        briefing.analysisStatus ===
                        'unavailable'
                    ) {
                        return vietnamese
                            ? 'Phân tích chưa khả dụng'
                            : 'Analysis unavailable';
                    }

                    if (
                        briefing.analysisStatus ===
                            'evaluated' ||
                        briefing.analysisStatus ===
                            'not-applicable'
                    ) {
                        return '';
                    }

                    if (
                        briefing.generationState === 'queued' &&
                        Number.isInteger(briefing.queueAhead) &&
                        briefing.queueAhead >= 0
                    ) {
                        return vietnamese
                            ? `✨ Đang chờ phân tích… · Còn ${briefing.queueAhead} bài phía trước`
                            : `✨ Waiting for analysis… · ${briefing.queueAhead} ahead`;
                    }

                    if (
                        briefing.generationStage ===
                        'synthesizing'
                    ) {
                        return vietnamese
                            ? '✨ Đang tổng hợp nguồn…'
                            : '✨ Synthesizing sources…';
                    }

                    if (
                        briefing.generationState ===
                        'generating'
                    ) {
                        const progress =
                            Number.isFinite(
                                briefing.progressPercent
                            ) &&
                            briefing.progressPercent >= 0 &&
                            briefing.progressPercent <= 100
                                ? ` · ${briefing.progressPercent}%`
                                : '';

                        return (
                            vietnamese
                                ? '✨ Đang phân tích…'
                                : '✨ Generating analysis…'
                        ) + progress;
                    }

                    return vietnamese
                        ? '✨ Đang chuẩn bị phân tích…'
                        : '✨ Preparing analysis…';
                },

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
                    if (!this.usesTopStories) { event.target.src = '/public/default.jpg'; return; }
                    const candidates = [...new Set([article.image, ...(article.imageCandidates || []), article.feedIcon, '/public/default.jpg'].filter(Boolean))];
                    const next = Number(event.target.dataset.fallback || 0) + 1;
                    event.target.dataset.fallback = next;
                    if (next < candidates.length) event.target.src = this.proxyImageUrl(candidates[next]);
                },
                topStoryError: '',
                briefingRefreshTimer: null,

                smartViewToken: '',
                rankingPending: false,
                get usesTopStories() { return this.selectedFilterType === 'smart' && this.smartTabMode === 'top'; },
                briefingFor(article) {
                    return article.briefing || { status: 'queued', headline: this.stripHtml(article.title), sections: [], sources: [] };
                },
                applyBriefingUpdates(updates) {
                    if (!this.usesTopStories) return false;
                    let applied = false;
                    for (const update of updates || []) {
                        const article = this.articles.find(item => (item.clusterId || item.link) === update.clusterId);
                        if (!article || !update.briefing) continue;
                        if (update.materialVersion != null && update.materialVersion !== article.topStory?.material_version) continue;
                        // A heartbeat sent before completion must not overwrite a pushed result.
                        if (article.briefing?.analysisStatus === 'evaluated' && update.briefing.analysisStatus !== 'evaluated') continue;
                        article.briefing = update.briefing;
                        applied = true;
                    }
                    return applied;
                },
                uniqueCitations(citations) { return [...new Map((citations || []).map(c => [c.link, c])).values()]; },
                scheduleBriefingRefresh(attempt = 0, delay = 300000) {
                    if (this.briefingRefreshTimer) clearTimeout(this.briefingRefreshTimer);
                    if (!this.usesTopStories) return;
                    const tab = this.selectedFilterValue;
                    const token = this.smartViewToken;
                    this.briefingRefreshTimer = setTimeout(async () => {
                        if (!this.usesTopStories || this.selectedFilterValue !== tab || this.smartViewToken !== token) return;

                        /*
                         * Do not download/parse a full Smart payload while
                         * the browser tab is hidden.
                         */
                        if (document.hidden) {
                            this.scheduleBriefingRefresh(
                                attempt,
                                60000
                            );
                            return;
                        }

                        try {
                            const page = (attempt % Math.max(1,this.currentPage)) + 1;
                            const response = await fetch('/api/data?' + new URLSearchParams({ filterType: 'smart', filterValue: tab, smartMode: 'top', smartRegion: this.smartRegion, smartView: token, briefingRefresh: '1', page, limit: this.isMobile ? 15 : 40, hideRead: this.hideRead, searchQuery: this.searchQuery || '' }));
                            if (!response.ok) throw new Error('Briefing refresh unavailable');
                            const latest = await response.json();
                            if (!this.usesTopStories || this.selectedFilterValue !== tab || this.smartViewToken !== token) return;
                            if (latest.viewReset) {
                                this.topUpdatesAvailable = true;
                                this.scheduleBriefingRefresh(attempt + 1);
                                return;
                            }
                            this.rankingPending = latest.rankingPending;
                            this.topUpdatesAvailable = latest.updatesAvailable === true;
                            const byId = new Map((latest.articles || []).map(s => [s.clusterId || s.link, s]));
                            for (const article of this.articles) { const updated = byId.get(article.clusterId || article.link); if (updated) Object.assign(article, updated); }
                        } catch { }
                        this.scheduleBriefingRefresh(attempt + 1);
                    }, delay);
                },
        };
    }
};

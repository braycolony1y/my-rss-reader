// Owns smart / sources on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderSmartSources = {
    create() {
        return {
                smartSourcesSettingsOpen: false,
                smartSources: [],
                smartSourceSearch: '',
                smartSourceSort: 'score',
                smartSourceFetchOpenUrl: '',
                loadingSmartSources: false,
                savingSmartSource: false,
                removingSmartSourceUrl: '',
                smartSourceError: '',
                newSmartSource: { title: '', url: '', kind: 'news_vietnam' },
                smartSourcePanel: 'sources',
                smartSourceKind: 'news_vietnam',
                smartSourceSections: [
                    { value: 'news_vietnam', short: 'News · VN', label: 'News · Vietnam' },
                    { value: 'news_global', short: 'News · Global', label: 'News · Global' },
                    { value: 'finance_vietnam', short: 'Finance · VN', label: 'Finance · Vietnam' },
                    { value: 'finance_global', short: 'Finance · Global', label: 'Finance · Global' },
                    { value: 'tech_vietnam', short: 'Tech · VN', label: 'Technology · Vietnam' },
                    { value: 'tech_global', short: 'Tech · Global', label: 'Technology · Global' }
                ],
                smartSourceView: 'enabled',
                smartDiscoveryKind: 'news_vietnam',
                smartDiscoveryCandidates: [],
                smartDiscoverySelected: [],
                discoveringSmartSources: false,
                savingDiscoveredSources: false,
                smartClusterVersion: '',
                smartExcludedCategories: [],
                smartExcludedFeedCategories: [],

                async fetchSmartSources() {
                    this.loadingSmartSources = true;
                    try {
                        const response = await fetch('/api/smart-sources');
                        if (!response.ok) return;
                        const data = await response.json();
                        this.smartSources = Array.isArray(data.sources) ? data.sources : [];
                    } catch (e) { }
                    finally { this.loadingSmartSources = false; }
                },

                async openSmartSourcesSettings() {
                    this.smartSourcesSettingsOpen = true;
                    this.mobileSidebarOpen = false;
                    this.smartSourceSearch = '';
                    this.smartSourceSort = 'score';
                    this.smartSourceError = '';
                    this.smartSourceView = 'enabled';
                    this.smartSourcePanel = 'sources';
                    this.smartDiscoveryCandidates = [];
                    this.smartDiscoverySelected = [];
                    await this.fetchSmartSources();
                },

                filteredSmartSources() {
                    const query = this.smartSourceSearch.trim().toLocaleLowerCase();
                    return [...this.smartSources]
                        .filter(source => this.smartSourceKindFor(source) === this.smartSourceKind)
                        .filter(source => this.smartSourceView === 'disabled' ? source.enabled === false : source.enabled !== false)
                        .filter(source => !query || [source.title, source.url, this.smartSourceCategoryLabel(source)].join(' ').toLocaleLowerCase().includes(query))
                        .sort((a, b) => {
                            if (this.smartSourceSort === 'score') {
                                const weightA = typeof a.weight === 'number' ? a.weight : 0;
                                const weightB = typeof b.weight === 'number' ? b.weight : 0;
                                if (weightA !== weightB) return weightB - weightA;
                            }
                            return String(a.category).localeCompare(String(b.category)) || String(a.region).localeCompare(String(b.region)) || String(a.title).localeCompare(String(b.title));
                        });
                },

                smartSourceHost(url) {
                    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; }
                },

                smartSourceIcon(source) {
                    const host = String(source.domain || this.smartSourceHost(source.url)).toLowerCase();
                    if (host.includes('tuoitre.vn')) return 'https://statictuoitre.mediacdn.vn/web_images/favicon.ico';
                    if (host.includes('kenh14.vn')) return 'https://kenh14cdn.com/web_images/kenh14-favicon.ico';
                    if (host.includes('soha.vn')) return 'https://sohanews.sohacdn.com/icons/soha-32.png';
                    if (host.includes('genk.vn')) return 'https://genk.mediacdn.vn/web_images/genk32.png';
                    if (host.includes('vjst.vn')) return 'https://ictv.1cdn.vn/assets/static/images/logo.png';
                    if (host.includes('vtv.vn')) return 'https://static.mediacdn.vn/vtv.vn/images/favicon.ico';
                    if (host.includes('doanhnhansaigon.vn')) return 'https://dnsg.1cdn.vn/assets/images/favicon.ico';
                    if (host.includes('tapchinganhang.gov.vn')) return 'https://tapchinganhang.gov.vn/modules/frontend/themes/tcnh/images/favicon/favicon.ico?v=2.620251216214508';
                    if (host.includes('vccinews.')) return 'https://vccinews.com/images/logo.png';
                    if (host.includes('haiquanonline.com.vn')) return 'https://www.google.com/s2/favicons?domain=customs.gov.vn&sz=64';
                    if (host.includes('pcworld.com')) return 'https://icons.duckduckgo.com/ip3/pcworld.com.ico';
                    return host ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64' : '';
                },

                smartSourceCategoryLabel(source) {
                    const labels = {
                        news_vietnam: 'News · Vietnam',
                        news_global: 'News · Global',
                        finance_vietnam: 'Finance · Vietnam',
                        finance_global: 'Finance · Global'
                    };
                    if (source.category === 'tech') return source.region === 'vietnam' ? 'Technology · Vietnam' : 'Technology · Global';
                    return labels[source.category] || 'News · Global';
                },

                smartSourceKindFor(source) {
                    if (source.category === 'tech') return source.region === 'vietnam' ? 'tech_vietnam' : 'tech_global';
                    return source.category || 'news_global';
                },

                smartSourceKindLabel(kind) {
                    return this.smartSourceSections.find(section => section.value === kind)?.label || 'News · Vietnam';
                },

                setSmartSourceKind(kind) {
                    this.smartSourceKind = kind;
                    this.newSmartSource.kind = kind;
                    this.smartDiscoveryKind = kind;
                    this.smartSourceSearch = '';
                    this.smartDiscoveryCandidates = [];
                    this.smartDiscoverySelected = [];
                    this.smartSourceError = '';
                },

                async addSmartSource() {
                    if (this.savingSmartSource) return;
                    this.savingSmartSource = true;
                    this.smartSourceError = '';
                    const kind = this.newSmartSource.kind;
                    const isTech = kind.startsWith('tech_');
                    const payload = {
                        title: this.newSmartSource.title.trim(),
                        url: this.newSmartSource.url.trim(),
                        category: isTech ? 'tech' : kind,
                        region: isTech ? (kind === 'tech_vietnam' ? 'vietnam' : 'foreign') : (kind.endsWith('_vietnam') ? 'vietnam' : 'foreign'),
                        weight: 1
                    };
                    try {
                        const response = await fetch('/api/smart-sources', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not add this source.');
                        this.smartSources = data.sources || [];
                        if (Array.isArray(data.feeds)) this.feeds = data.feeds;
                        this.newSmartSource = { title: '', url: '', kind };
                        this.smartSourcePanel = 'sources';
                        this.smartSourceView = 'enabled';
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.savingSmartSource = false;
                    }
                },

                async toggleSmartSource(source) {
                    this.removingSmartSourceUrl = source.url;
                    this.smartSourceError = '';
                    try {
                        const response = await fetch('/api/smart-sources', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: source.url, enabled: source.enabled === false })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not update this source.');
                        this.smartSources = data.sources || [];
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.removingSmartSourceUrl = '';
                    }
                },

                smartSourceHasFetchMethod(source, method) {
                    return Array.isArray(source?.fetchMethods) && source.fetchMethods.includes(method);
                },

                toggleSmartSourceFetchPanel(source) {
                    const url = source?.url || '';
                    this.smartSourceFetchOpenUrl = this.smartSourceFetchOpenUrl === url ? '' : url;
                },

                async toggleSmartSourceFetchMethod(source, method) {
                    const previous = Array.isArray(source.fetchMethods)
                        ? [...source.fetchMethods]
                        : [];

                    const fetchMethods = previous.includes(method)
                        ? previous.filter(value => value !== method)
                        : [...previous, method];

                    // Update checkbox immediately.
                    source.fetchMethods = [...fetchMethods];
                    this.smartSourceError = '';

                    const version = Number(source.__fetchMethodsVersion || 0) + 1;
                    source.__fetchMethodsVersion = version;

                    const save = async () => {
                        try {
                            const response = await fetch('/api/smart-sources', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    url: source.url,
                                    fetchMethods
                                })
                            });

                            const data = await response.json().catch(() => ({}));

                            if (!response.ok) {
                                throw new Error(
                                    data.error || 'Could not update fetch methods.'
                                );
                            }

                            if (source.__fetchMethodsVersion === version) {
                                const savedSource = Array.isArray(data.sources)
                                    ? data.sources.find(item => item?.url === source.url)
                                    : null;

                                if (savedSource && Array.isArray(savedSource.fetchMethods)) {
                                    source.fetchMethods = [...savedSource.fetchMethods];
                                }
                            }

                            if (Array.isArray(data.feeds)) {
                                this.feeds = data.feeds;
                            }

                            if (this.articleContentCache) {
                                this.articleContentCache.clear();
                            }
                        } catch (error) {
                            if (source.__fetchMethodsVersion === version) {
                                source.fetchMethods = [...previous];
                                this.smartSourceError = error.message;
                            }
                            throw error;
                        }
                    };

                    const previousSave =
                        this.__smartFetchMethodSaveQueue || Promise.resolve();

                    const currentSave = previousSave
                        .catch(() => {})
                        .then(save);

                    this.__smartFetchMethodSaveQueue = currentSave;

                    try {
                        await currentSave;
                    } catch {
                        // rollback already handled
                    }
                },

                toggleSmartDiscoverySelection(url) {
                    this.smartDiscoverySelected = this.smartDiscoverySelected.includes(url)
                        ? this.smartDiscoverySelected.filter(value => value !== url)
                        : [...this.smartDiscoverySelected, url];
                },

                async fetchSmartSettings() {
                    try {
                        const response = await fetch('/api/smart-settings');
                        const data = await response.json();
                        this.smartExcludedCategories = data.excludedCategories || [];
                        this.smartExcludedFeedCategories = data.excludedFeedCategories || [];
                    } catch (e) { }
                },

                async toggleSmartCategoryExclusion(kind) {
                    if (this.smartExcludedCategories.includes(kind)) {
                        this.smartExcludedCategories = this.smartExcludedCategories.filter(k => k !== kind);
                    } else {
                        this.smartExcludedCategories.push(kind);
                    }
                    try {
                        await fetch('/api/smart-settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ excludedCategories: this.smartExcludedCategories, excludedFeedCategories: this.smartExcludedFeedCategories })
                        });
                    } catch (e) { }
                },

                async updateSmartExcludedFeedCategories() {
                    try {
                        await fetch('/api/smart-settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ excludedCategories: this.smartExcludedCategories, excludedFeedCategories: this.smartExcludedFeedCategories })
                        });
                    } catch (e) { }
                },

                async discoverSmartSources() {
                    if (this.discoveringSmartSources) return;
                    this.discoveringSmartSources = true;
                    this.smartSourceError = '';
                    const kind = this.smartSourceKind;
                    const isTech = kind.startsWith('tech_');
                    try {
                        const response = await fetch('/api/smart-sources/discover', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                category: isTech ? 'tech' : kind,
                                region: isTech ? (kind === 'tech_vietnam' ? 'vietnam' : 'foreign') : (kind.endsWith('_vietnam') ? 'vietnam' : 'foreign')
                            })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not search for sources.');
                        this.smartSources = data.sources || this.smartSources;
                        this.smartDiscoveryCandidates = data.candidates || [];
                        this.smartDiscoverySelected = [];
                        if (!this.smartDiscoveryCandidates.length) this.smartSourceError = 'No more curated sources are available for this section. Previously skipped sources remain under “Not used”.';
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.discoveringSmartSources = false;
                    }
                },

                async enableSelectedDiscoveredSources() {
                    if (!this.smartDiscoverySelected.length || this.savingDiscoveredSources) return;
                    this.savingDiscoveredSources = true;
                    this.smartSourceError = '';
                    try {
                        for (const url of this.smartDiscoverySelected) {
                            const response = await fetch('/api/smart-sources', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url, enabled: true })
                            });
                            const data = await response.json();
                            if (!response.ok) throw new Error(data.error || 'Could not add a selected source.');
                            this.smartSources = data.sources || this.smartSources;
                        }
                        this.smartDiscoveryCandidates = [];
                        this.smartDiscoverySelected = [];
                        this.smartSourcePanel = 'sources';
                        this.smartSourceView = 'enabled';
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.savingDiscoveredSources = false;
                    }
                },

                async resetSmartSources() {
                    if (!confirm('Restore the built-in Smart source list? Custom source changes will be replaced.')) return;
                    this.smartSourceError = '';
                    try {
                        const response = await fetch('/api/smart-sources/reset', { method: 'POST' });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not restore the source list.');
                        this.smartSources = data.sources || [];
                        if (Array.isArray(data.feeds)) this.feeds = data.feeds;
                    } catch (error) {
                        this.smartSourceError = error.message;
                    }
                },
        };
    }
};

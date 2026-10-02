// Owns board / cache on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderBoardCache = {
    create() {
        return {
                get cacheRuleSources() {
                    return [...new Map([...this.feeds, ...this.smartSources].filter(source => source?.url).map(source => [source.url, source])).values()];
                },
                cacheRules: [],
                cacheMembers: {},
                cacheRulesOpen: false,
                cacheRulesSaving: false,
                cacheNotice: '',
                cacheHistory: null,
                historyFrom: 0,
                historyTo: 1,
                async cacheRequest(url, options = {}) {
                    const response = await fetch(url, options);
                    const text = await response.text();
                    let data;
                    try { data = JSON.parse(text); } catch {
                        if (response.status === 401) throw new Error('Please sign in again to save your Board changes.');
                        if (response.status === 413) throw new Error('This save request is too large. Reload the page and try again.');
                        throw new Error(`Could not save Board changes (HTTP ${response.status}). Please reload and try again.`);
                    }
                    if (!response.ok) throw new Error(data.error || 'Could not save Board changes');
                    return data;
                },
                async loadCacheState() {
                    if (!this.isLoggedIn || this.boardSavePending) return;
                    const boardVersion = this.boardMutationVersion;
                    try {
                        const data = await this.cacheRequest('/api/board-cache');
                        if (this.boardSavePending || boardVersion !== this.boardMutationVersion) return;
                        const membershipChanged = JSON.stringify(Object.entries(this.cacheMembers).map(([id, m]) => [id, m.in_cache])) !== JSON.stringify(Object.entries(data.members).map(([id, m]) => [id, m.in_cache]));
                        for (const [id, active] of Object.entries(this.cacheTogglePending)) if (data.members[id]) data.members[id].active_caching = active;
                        this.cacheMembers = data.members;
                        if (membershipChanged && this.selectedFilterType === 'board') this.fetchData();
                        if (!this.cacheRulesOpen) this.cacheRules = data.rules;
                    } catch (e) { this.cacheNotice = e.message; }
                },
                cacheMember(article) {
                    if (!article) return null;
                    const raw = typeof article === 'string' ? article : article.resolvedLink || article.originalLink || article.link;
                    let id;
                    try {
                        const u = new URL(raw);
                        const match = u.pathname.match(/^\/(?:t|threads)\/(?:[^/]*\.)?(\d+)(?:\/|$)/i);
                        if (match) id = `${u.hostname.toLowerCase()}:thread:${match[1]}`;
                        else {
                            u.hash = '';
                            for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
                            u.searchParams.sort(); u.pathname = u.pathname.replace(/\/+$/, '') || '/'; id = u.href;
                        }
                    } catch { return null; }
                    const member = this.cacheMembers[id];
                    return member?.in_cache ? member : null;
                },
                cacheTogglePending: {},
                cacheBadgeText(article) {
                    const m = this.cacheMember(article);
                    if (m?.source_removed) return 'Removed from source';
                    if (!m?.active_caching && m?.stop_reason === 'verified_idle_24h') return 'Idle >24h · paused';
                    return !m?.active_caching ? 'Cache paused' : m?.sync_status === 'incomplete' ? 'Sync delayed' : 'Live cache';
                },
                cacheLastSuccessText(article) {
                    const value = this.cacheMember(article)?.last_successful_sync_at || article?.cacheLastSync;
                    return value ? 'Last cached successfully: ' + this.formatVietnamDateTime(value) : 'Waiting for first successful cache';
                },
                cacheBadgeTitle(article) {
                    const m = this.cacheMember(article);
                    const action = m?.active_caching
                        ? 'Click to pause.'
                        : m?.stop_reason === 'verified_idle_24h'
                            ? 'The real VOZ tail was verified idle for more than 24 hours. Click to reactivate live caching.'
                            : 'Click to resume.';
                    return `${this.cacheBadgeText(article)}. ${action}${m?.last_successful_sync_at ? ' Last successful sync: ' + this.formatVietnamDateTime(m.last_successful_sync_at) : ''}`;
                },
                async setCacheActive(article) {
                    const member = this.cacheMember(article);
                    if (!member || Object.hasOwn(this.cacheTogglePending, member.thread_id)) return;
                    const previous = member.active_caching;
                    this.cacheTogglePending[member.thread_id] = !previous;
                    member.active_caching = !previous;
                    try {
                        await this.cacheRequest('/api/board-cache/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: member.url, active: !previous }) });
                    } catch (e) { member.active_caching = previous; if (this.cacheMembers[member.thread_id]) this.cacheMembers[member.thread_id].active_caching = previous; this.cacheNotice = e.message; }
                    finally { delete this.cacheTogglePending[member.thread_id]; }
                },
                async openCacheRules() {
                    this.cacheRulesOpen = true;
                    await this.loadCacheState();
                    this.cacheNotice = '';
                },
                addCacheRule() {
                    this.cacheRules.push({ id: crypto.randomUUID(), keywords: [], source: '', enabled: true });
                },
                normalizeKeywordPhrase(value) {
                    return String(value || '').normalize('NFKC').toLowerCase().trim();
                },
                normalizeKeywordList(values) {
                    return [...new Set((Array.isArray(values) ? values : []).map(value => this.normalizeKeywordPhrase(value)).filter(Boolean))];
                },
                addCacheKeyword(rule, input) {
                    const value = this.normalizeKeywordPhrase(input.value);
                    rule.keywords = this.normalizeKeywordList(rule.keywords);
                    if (value && !rule.keywords.includes(value)) rule.keywords.push(value);
                    input.value = '';
                },
                editCacheKeyword(rule, index, input) {
                    const value = this.normalizeKeywordPhrase(input.value);
                    if (value) rule.keywords.splice(index, 1, value);
                    else rule.keywords.splice(index, 1);
                    rule.keywords = this.normalizeKeywordList(rule.keywords);
                },
                async saveCacheRules() {
                    this.cacheRulesSaving = true; this.cacheNotice = '';
                    try {
                        const data = await this.cacheRequest('/api/board-cache/rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: this.cacheRules }) });
                        this.cacheRules = data.rules;
                        this.cacheRulesOpen = false;
                        this.cacheNotice = 'Auto Cache Rules saved';
                    } catch (e) { this.cacheNotice = e.message; }
                    finally { this.cacheRulesSaving = false; }
                },
                async copyFolderUrl() {
                    try {
                        await navigator.clipboard.writeText(location.origin + location.pathname + '#board' + (this.selectedFilterValue ? '/' + encodeURIComponent(this.selectedFilterValue) : ''));
                        this.cacheNotice = 'Folder link copied';
                    } catch { this.cacheNotice = 'Could not copy the link'; }
                },
                async openPostHistory(event) {
                    const button = event.target.closest('[data-cache-history]');
                    if (!button || !this.overlayArticle) return;
                    event.stopPropagation();
                    try {
                        const data = await this.cacheRequest('/api/board-cache/archive?' + new URLSearchParams({ url: this.articleReaderUrl(this.overlayArticle) }));
                        const post = data.archive?.posts[button.dataset.cacheHistory];
                        if (!post || post.versions.length < 2) return;
                        this.cacheHistory = post;
                        this.historyFrom = post.versions.length - 2;
                        this.historyTo = post.versions.length - 1;
                    } catch (e) { this.cacheNotice = e.message; }
                },
                historyText(version) {
                    const doc = new DOMParser().parseFromString(version?.content || '', 'text/html');
                    doc.querySelectorAll('img').forEach(img => img.replaceWith(doc.createTextNode(` [Image: ${img.getAttribute('src') || img.alt}] `)));
                    doc.querySelectorAll('a').forEach(a => a.append(doc.createTextNode(` (${a.getAttribute('href') || ''})`)));
                    return doc.body.textContent || '';
                },
                historyDiff() {
                    if (!this.cacheHistory) return '';
                    const from = this.cacheHistory.versions[this.historyFrom], to = this.cacheHistory.versions[this.historyTo];
                    const beforeText = this.historyText(from), afterText = this.historyText(to);
                    const markupChanged = beforeText === afterText && from.content !== to.content;
                    const before = (markupChanged ? from.content : beforeText).split(/(\s+)/);
                    const after = (markupChanged ? to.content : afterText).split(/(\s+)/);
                    const escape = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
                    let start = 0, end = 0;
                    while (start < before.length && start < after.length && before[start] === after[start]) start++;
                    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
                    const a = before.slice(start, before.length - end), b = after.slice(start, after.length - end);
                    let middle = '';
                    if (a.length * b.length > 250000) middle = `<del>${escape(a.join(''))}</del><ins>${escape(b.join(''))}</ins>`;
                    else {
                        const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
                        for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i+1][j+1] + 1 : Math.max(dp[i+1][j], dp[i][j+1]);
                        let i = 0, j = 0;
                        while (i < a.length || j < b.length) {
                            if (i < a.length && j < b.length && a[i] === b[j]) { middle += escape(a[i++]); j++; }
                            else if (j < b.length && (i === a.length || dp[i][j+1] >= dp[i+1][j])) middle += `<ins>${escape(b[j++])}</ins>`;
                            else middle += `<del>${escape(a[i++])}</del>`;
                        }
                    }
                    return (markupChanged ? '<p>Formatting or embedded content changed:</p>' : '') + escape(before.slice(0, start).join('')) + middle + escape(end ? before.slice(-end).join('') : '');
                },
        };
    }
};

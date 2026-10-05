// Ephemeral UI session. Only applySmartFeedback calls the mutation endpoint.
const ReaderSmartFeedback = {
    suggestionTimeoutMs: 12000,
    create() {
        let suggestionRequest = null;
        return {
            feedbackSession: null, feedbackBusy: false, feedbackMessage: '', feedbackToast: null,
            feedbackHidden: [], feedbackApplied: [], feedbackPosition: '', feedbackReturnFocus: null,
            openSmartFeedback(article, event) {
                if (this.selectedFilterType !== 'smart') return;
                this.cancelSmartFeedback();
                const section = article.topStory?.feed || (this.selectedFilterValue && this.selectedFilterValue !== '__all' ? this.selectedFilterValue : SmartFeedbackSemantics.section(article));
                const subject = { ...article, feedbackSection: section };
                this.feedbackReturnFocus = event?.currentTarget;
                const bounds = event?.currentTarget?.getBoundingClientRect();
                const left = Math.max(12, Math.min(window.innerWidth - 452, (bounds?.right || window.innerWidth / 2) - 430));
                const top = Math.max(12, Math.min(window.innerHeight - 530, (bounds?.bottom || 90) + 8));
                this.feedbackPosition = `left:${left}px;top:${top}px`;
                const pool = SmartFeedbackSemantics.pool(subject);
                this.feedbackSession = { token: crypto.randomUUID(), article: subject, surface: this.usesTopStories ? 'smart_top' : 'classic',
                    pool, displayed: pool.slice(0, 6), rejected: [], selected: [], round: 0, workVersion: 0, other: false, input: '', interpretation: null, reviewed: false };
                this.feedbackMessage = '';
                this.$nextTick(() => document.querySelector('#smart-feedback-picker button')?.focus());
            },
            cancelSmartFeedback() {
                if (this.feedbackBusy === 'apply') return;
                this.stopFeedbackSuggestion();
                this.feedbackSession = null;
                this.feedbackBusy = false;
                this.feedbackMessage = '';
                this.feedbackReturnFocus?.focus?.();
                this.feedbackReturnFocus = null;
            },
            feedbackContextChanged() {
                if (this.feedbackSession) this.cancelSmartFeedback();
            },
            toggleFeedbackReason(reason) {
                const session = this.feedbackSession;
                if (!session || this.feedbackBusy) return;
                session.selected = session.selected.includes(reason.id) ? session.selected.filter(id => id !== reason.id) : [...session.selected, reason.id];
            },
            get feedbackCanApply() {
                const session = this.feedbackSession;
                return !!session && !this.feedbackBusy && (session.selected.length > 0 || !!(session.other && session.interpretation && session.reviewed));
            },
            feedbackReference(article) { return { link: article.link, clusterId: article.clusterId, feedbackSection: article.feedbackSection }; },
            stopFeedbackSuggestion() {
                if (this.feedbackSession) this.feedbackSession.workVersion++;
                suggestionRequest?.abort();
                suggestionRequest = null;
                if (['suggestions', 'interpretation'].includes(this.feedbackBusy)) {
                    this.feedbackBusy = false;
                    this.feedbackMessage = '';
                }
            },
            openOtherFeedback() {
                if (this.feedbackBusy === 'apply') return;
                this.stopFeedbackSuggestion();
                if (this.feedbackSession) this.feedbackSession.other = !this.feedbackSession.other;
                this.$nextTick(() => document.querySelector('#feedback-text')?.focus());
            },
            updateFeedbackText(value) {
                if (!this.feedbackSession) return;
                if (this.feedbackBusy === 'interpretation') this.stopFeedbackSuggestion();
                this.feedbackSession.input = value;
                this.feedbackSession.interpretation = null;
                this.feedbackSession.reviewed = false;
            },
            async feedbackRequest(path, body, method = 'POST') {
                const controller = path === 'suggestions' ? new AbortController() : null;
                let timer, rejectAbort;
                if (controller) {
                    suggestionRequest?.abort();
                    suggestionRequest = controller;
                }
                const read = async () => {
                    const response = await fetch('/api/smart-feedback/' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(controller ? { signal: controller.signal } : {}) });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || 'Could not save. Please try again.');
                    return result;
                };
                if (!controller) return read(); // Apply retains its idempotent confirmation semantics.
                const stopped = new Promise((_, reject) => {
                    rejectAbort = () => reject(new Error('Finding more reasons took too long. Try again or use Other.'));
                    controller.signal.addEventListener('abort', rejectAbort, { once: true });
                    timer = setTimeout(() => controller.abort(), ReaderSmartFeedback.suggestionTimeoutMs);
                });
                try { return await Promise.race([read(), stopped]); }
                finally {
                    clearTimeout(timer);
                    controller.signal.removeEventListener('abort', rejectAbort);
                    if (suggestionRequest === controller) suggestionRequest = null;
                }
            },
            async differentFeedbackReasons() {
                const session = this.feedbackSession;
                if (!session || this.feedbackBusy) return;
                session.rejected = [...new Set([...session.rejected, ...session.displayed.map(reason => reason.id)])];
                session.selected = []; session.interpretation = null; session.reviewed = false; session.input = ''; session.other = false;
                session.round++;
                const workVersion = ++session.workVersion;
                const remaining = session.pool.filter(reason => !SmartFeedbackSemantics.isRejected(reason.rule, session.rejected));
                session.displayed = remaining.slice(0, 6);
                this.feedbackBusy = 'suggestions';
                this.feedbackMessage = 'Finding different reasons…';
                try {
                    // Consume unused local candidates before any optional request.
                    let result = { reasons: remaining.slice(0, 6) };
                    if (remaining.length < 4) result = await this.feedbackRequest('suggestions', { article: this.feedbackReference(session.article), rejected: session.rejected });
                    if (this.feedbackSession?.token !== session.token || session.workVersion !== workVersion) return;
                    session.displayed = result.reasons.filter(r => !SmartFeedbackSemantics.isRejected(r.rule, session.rejected));
                    session.pool = [...new Map([...session.pool, ...session.displayed].map(r => [r.id, r])).values()];
                    this.feedbackMessage = result.message || (session.displayed.length ? `Different reasons ready. Set ${session.round + 1}.` : 'No more supported reasons found. Try Other, ask again, or cancel.');
                } catch (error) {
                    if (this.feedbackSession?.token === session.token && session.workVersion === workVersion) this.feedbackMessage = error.message + ' You can still use Other or cancel.';
                } finally { if (this.feedbackSession?.token === session.token && session.workVersion === workVersion) this.feedbackBusy = false; }
            },
            async interpretFeedbackText() {
                const session = this.feedbackSession;
                if (!session?.input.trim() || this.feedbackBusy) return;
                const workVersion = ++session.workVersion;
                this.feedbackBusy = 'interpretation';
                session.interpretation = null; session.reviewed = false;
                this.feedbackMessage = 'Interpreting your reason…';
                try {
                    const result = await this.feedbackRequest('suggestions', { article: this.feedbackReference(session.article), input: session.input });
                    if (this.feedbackSession?.token !== session.token || session.workVersion !== workVersion) return;
                    session.interpretation = result.reasons[0] || null;
                    this.feedbackMessage = session.interpretation ? 'Review the meaning below before applying.' : (result.message || 'Please make the reason more specific, for example a person or company and the type of story.');
                } catch (error) { if (this.feedbackSession?.token === session.token && session.workVersion === workVersion) this.feedbackMessage = error.message; }
                finally { if (this.feedbackSession?.token === session.token && session.workVersion === workVersion) this.feedbackBusy = false; }
            },
            async applySmartFeedback() {
                if (!this.feedbackCanApply) return;
                const session = this.feedbackSession;
                const selectedReasons = session.displayed.filter(reason => session.selected.includes(reason.id));
                if (session.other && session.interpretation && session.reviewed) selectedReasons.push(session.interpretation);
                if (!selectedReasons.length) return;
                this.feedbackBusy = 'apply'; this.feedbackMessage = 'Saving preferences…';
                try {
                    const result = await this.feedbackRequest('apply', { confirmed: true, article: this.feedbackReference(session.article), surface: session.surface, selectedReasons, requestId: session.token });
                    const article = session.article;
                    this.feedbackHidden = [...this.feedbackHidden, article.link];
                    this.feedbackToast = { eventId: result.event.id, article, index: this.articles.findIndex(a => a.link === article.link), message: 'Story hidden. Future matching Smart stories will be filtered.' };
                    this.feedbackApplied = [...this.feedbackApplied, this.feedbackToast];
                    this.feedbackBusy = false;
                    this.cancelSmartFeedback();
                } catch (error) { this.feedbackBusy = false; this.feedbackMessage = error.message; }
            },
            isSmartFeedbackHidden(article) { return this.selectedFilterType === 'smart' && this.feedbackHidden.includes(article.link); },
            async undoSmartFeedback(eventId = this.feedbackToast?.eventId) {
                if (!eventId || this.feedbackBusy) return;
                this.feedbackBusy = 'undo';
                try {
                    await this.feedbackRequest('undo', { eventId });
                    const toast = this.feedbackApplied.find(item => item.eventId === eventId) || (this.feedbackToast?.eventId === eventId ? this.feedbackToast : null);
                    if (toast) {
                        this.feedbackHidden = this.feedbackHidden.filter(link => link !== toast.article.link);
                        if (this.selectedFilterType === 'smart' && !this.articles.some(a => a.link === toast.article.link)) this.articles.splice(Math.max(0, toast.index), 0, toast.article);
                        if (this.feedbackToast?.eventId === eventId) this.feedbackToast = null;
                        this.feedbackApplied = this.feedbackApplied.filter(item => item.eventId !== eventId);
                    }
                    if (this.logsPanelOpen) await this.fetchFilterLog();
                } catch (error) { this.feedbackMessage = error.message; }
                finally { this.feedbackBusy = false; }
            },
            async manageSmartFilters() {
                this.logsPanelOpen = true; this.logsTab = 'filtered';
                this.$nextTick?.(() => document.querySelector('.monitor-tabs button:last-child')?.focus());
                await this.fetchFilterLog();
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

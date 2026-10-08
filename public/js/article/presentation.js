const readerVietnamDateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
// Owns article / presentation on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticlePresentation = {
    create() {
        return {
                clockNow: Date.now(),
                formatPostTime(value) {
                    const date = new Date(value), now = new Date(this.clockNow);
                    if (!Number.isFinite(date.getTime())) return '';
                    const minutes = Math.max(0, Math.floor((now - date) / 60000));
                    if (minutes < 1) return 'Just now';
                    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
                    if (minutes < 120) return '1 hour ago';
                    const time = ReaderSourceTimeFormat.time.format(date);
                    const calendarDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
                    const days = (calendarDay(now) - calendarDay(date)) / 86400000;
                    if (days === 0) return `Today at ${time}`;
                    if (days === 1) return `Yesterday at ${time}`;
                    if (days > 1 && days < 7) return `${ReaderSourceTimeFormat.weekday.format(date)} at ${time}`;
                    return ReaderSourceTimeFormat.date.format(date);
                },
                formatSourceTimeMarkup(content) {
                    if (!content || !content.includes('data-source-time')) return content;
                    const parsed = new DOMParser().parseFromString(content, 'text/html');
                    this.updateSourceTimes(parsed);
                    return parsed.body.innerHTML;
                },
                updateSourceTimes(root = document) {
                    root.querySelectorAll('time[data-source-time]').forEach(el => {
                        const date = new Date(el.dataset.sourceTime);
                        if (!Number.isFinite(date.getTime())) return;
                        const exact = ReaderSourceTimeFormat.exact.format(date);
                        el.textContent = el.dataset.showExact === 'true' ? exact : this.formatPostTime(date);
                        el.title = exact;
                        el.setAttribute('aria-label', exact);
                        el.setAttribute('aria-expanded', String(el.dataset.showExact === 'true'));
                    });
                },
                toggleSourceTime(event) {
                    const el = event.target.closest('time[data-source-time]');
                    if (!el) return false;
                    event.preventDefault(); event.stopPropagation();
                    el.dataset.showExact = el.dataset.showExact === 'true' ? 'false' : 'true';
                    this.updateSourceTimes();
                    return true;
                },
                cardSourceTime(article, exactOnly = false) {
                    const member = this.cacheMember(article);
                    const source = member ? member.source_created_at || article.source_created_at || article.createDate : article.source_created_at || article.createDate || article.pubDate;
                    const value = source || member?.cached_at;
                    if (!value || !Number.isFinite(new Date(value).getTime())) return 'Creation time unavailable';
                    const exact = this.formatVietnamDateTime(value);
                    return exactOnly ? exact : this.timeAgo(value);
                },

                stripHtml(html) {
                    if (!html) return '';
                    let text = html.replace(/<[^>]*>?/gm, '');
                    if (!this._decodeTextArea) this._decodeTextArea = document.createElement('textarea');
                    for (let pass = 0; pass < 3; pass++) {
                        this._decodeTextArea.innerHTML = text;
                        const decoded = this._decodeTextArea.value;
                        if (decoded === text) break;
                        text = decoded;
                    }
                    return text.trim().replace(/^\*\*([\s\S]*?)\*\*$/, '$1').trim();
                },
                formatText(text) {
                    if (!text) return '';
                    // Escape HTML first to prevent XSS
                    const escaped = text.replace(/[&<>'"]/g, tag => ({
                        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
                    }[tag]));
                    // Replace bold markdown with <b>
                    const formatted = escaped.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                    return formatted;
                },

                proxyImageUrl(url) {
                    if (!url) return "";
                    if (url.startsWith('/api/og-image')) {
                        try {
                            const versioned = new URL(url, window.location.origin);
                            versioned.searchParams.set('v', '32');
                            return versioned.pathname + versioned.search;
                        } catch (error) { }
                    }
                    if (url.includes("baodautu.vn") || url.includes("baoxaydung.com.vn") || url.includes("baoxaydung.vn")) {
                        return "/api/proxy-image?url=" + encodeURIComponent(url);
                    }
                    return url;
                },

                formatCount(n) {
                    if (n == null || isNaN(n)) return '0';
                    n = Number(n);
                    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
                    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
                    return String(n);
                },

                timeAgo(dateString) {
                    if (!dateString) return '';
                    const date = new Date(dateString);
                    const seconds = Math.floor(((this.clockNow || Date.now()) - date.getTime()) / 1000);

                    if (seconds < 0) return "Just now";
                    
                    let interval = seconds / 31536000;
                    if (interval > 1) return Math.floor(interval) + "y";
                    interval = seconds / 2592000;
                    if (interval > 1) return Math.floor(interval) + "mo";
                    interval = seconds / 86400;
                    if (interval > 1) return Math.floor(interval) + "d";
                    interval = seconds / 3600;
                    if (interval > 1) return Math.floor(interval) + "h";
                    interval = seconds / 60;
                    if (interval > 1) return Math.floor(interval) + "m";
                    return Math.floor(seconds) + "s";
                },

                formatVietnamDateTime(dateString) {
                    if (!dateString) return 'Time unavailable';
                    const date = new Date(dateString);
                    return Number.isNaN(date.getTime()) ? 'Time unavailable' : readerVietnamDateFormatter.format(date);
                }
        };
    }
};

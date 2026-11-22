// Owns article / export on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticleExport = {
    create() {
        return {
                articleCopyState: 'idle',
                articleCopyResetTimer: null,
                articlePdfState: 'idle',
                articlePdfProgress: { current: 0, total: 0, message: '' },
                articlePdfAbortController: null,
                articlePdfJobId: null,
                articlePdfResetTimer: null,

                setArticleCopyState(state) {
                    if (this.articleCopyResetTimer) clearTimeout(this.articleCopyResetTimer);
                    this.articleCopyResetTimer = null;
                    this.articleCopyState = state;
                    if (state === 'success' || state === 'error') {
                        this.articleCopyResetTimer = setTimeout(() => {
                            this.articleCopyState = 'idle';
                            this.articleCopyResetTimer = null;
                        }, 2200);
                    }
                },

                buildArticleClipboardPayload() {
                    if (!this.overlayArticle) return null;
                    const rawHero = this.overlayArticle.overlayImage || this.overlayArticle.image || '';
                    return this.buildArticleExportPayload(this.overlayArticle, this.overlayContent, rawHero);
                },

                buildArticleExportPayload(articleInput, contentInput, rawHeroInput = '', options = {}) {
                    if (!articleInput || !contentInput || typeof document === 'undefined') return null;

                    const sourceUrl = this.articleReaderUrl(articleInput) || window.location.href;
                    const clipboardDocument = document.implementation.createHTMLDocument('');
                    const article = clipboardDocument.createElement('article');
                    const title = clipboardDocument.createElement('h1');
                    title.textContent = this.stripHtml(articleInput.overlayTitle || articleInput.title || 'Article');
                    article.appendChild(title);

                    const metadata = [articleInput.overlayAuthor || articleInput.author].filter(Boolean);
                    const publishedAt = articleInput.overlayDate || articleInput.pubDate;
                    if (publishedAt && articleInput.publicationTimeReliable !== false) {
                        try { metadata.push(this.formatVietnamDateTime(publishedAt)); } catch (error) { }
                    }
                    if (metadata.length) {
                        const byline = clipboardDocument.createElement('p');
                        byline.textContent = metadata.join(' · ');
                        article.appendChild(byline);
                    }

                    const source = clipboardDocument.createElement('p');
                    const sourceLink = clipboardDocument.createElement('a');
                    sourceLink.href = sourceUrl;
                    sourceLink.textContent = sourceUrl;
                    source.appendChild(sourceLink);
                    article.appendChild(source);

                    const portableImageUrl = rawSrc => {
                        if (!rawSrc) return '';
                        try {
                            const baseUrl = rawSrc.startsWith('/api/') ? window.location.origin : sourceUrl;
                            const resolved = new URL(rawSrc, baseUrl);
                            // Printing runs on the reader's origin, so keep its working image proxies.
                            if (options.forPrint) return resolved.href;
                            if (resolved.pathname === '/api/proxy-image' && resolved.searchParams.get('url')) {
                                return resolved.searchParams.get('url');
                            }
                            return resolved.href;
                        } catch (error) {
                            return rawSrc;
                        }
                    };

                    const content = clipboardDocument.createElement('div');
                    content.innerHTML = contentInput;
                    content.querySelectorAll('script, style, noscript, template, form, button').forEach(node => node.remove());
                    content.querySelectorAll('iframe').forEach(frame => {
                        const rawSrc = frame.getAttribute('src');
                        if (!rawSrc) {
                            frame.remove();
                            return;
                        }
                        const link = clipboardDocument.createElement('a');
                        try { link.href = new URL(rawSrc, sourceUrl).href; } catch (error) { link.href = rawSrc; }
                        link.textContent = frame.getAttribute('title') || 'Interactive graphic';
                        frame.replaceWith(link);
                    });

                    const copiedImages = [];
                    content.querySelectorAll('img').forEach(image => {
                        const rawSrc = image.getAttribute('src') || image.getAttribute('data-src') || '';
                        if (!rawSrc) {
                            image.remove();
                            return;
                        }
                        const portableSrc = portableImageUrl(rawSrc);
                        image.setAttribute('src', portableSrc);
                        image.removeAttribute('srcset');
                        image.removeAttribute('data-src');
                        image.removeAttribute('loading');
                        image.style.maxWidth = '100%';
                        image.style.height = 'auto';
                        copiedImages.push({ src: portableSrc, alt: image.getAttribute('alt') || 'Article image' });
                    });
                    content.querySelectorAll('a[href]').forEach(link => {
                        const href = link.getAttribute('href') || '';
                        if (!href || href.startsWith('#')) return;
                        try { link.setAttribute('href', new URL(href, sourceUrl).href); } catch (error) { }
                    });
                    content.querySelectorAll('*').forEach(node => {
                        for (const attribute of [...node.attributes]) {
                            if (/^on/i.test(attribute.name) || /^x-|^@|^:/i.test(attribute.name)) {
                                node.removeAttribute(attribute.name);
                            }
                        }
                    });

                    const rawHero = rawHeroInput || articleInput.overlayImage || articleInput.image || '';
                    const portableHero = portableImageUrl(rawHero);
                    const heroIsPortable = portableHero && !portableHero.includes('/api/og-image');
                    if (heroIsPortable && !copiedImages.some(image => image.src === portableHero)) {
                        const hero = clipboardDocument.createElement('img');
                        hero.src = portableHero;
                        hero.alt = title.textContent;
                        hero.style.maxWidth = '100%';
                        hero.style.height = 'auto';
                        article.appendChild(hero);
                        copiedImages.unshift({ src: portableHero, alt: hero.alt });
                    }
                    article.appendChild(content);

                    const plainBody = (content.innerText || content.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
                    const imageText = copiedImages.map(image => `[Image: ${image.alt}] ${image.src}`).join('\n');
                    const plainText = [title.textContent, metadata.join(' · '), sourceUrl, plainBody, imageText]
                        .filter(Boolean)
                        .join('\n\n');
                    return { html: article.outerHTML, text: plainText };
                },

                buildArticlePrintPayload(contentInput) {
                    const payload = this.buildArticleExportPayload(this.overlayArticle, contentInput, '', { forPrint: true });
                    if (!payload) return null;
                    const parsed = new DOMParser().parseFromString(payload.html, 'text/html');
                    const article = parsed.querySelector('article');
                    const content = article.lastElementChild;
                    content.classList.add('article-rendered-content');
                    article.classList.add('article-print');

                    // Copy the rendered hero, title and metadata so the export follows
                    // the reader's actual layout, including avatars and image captions.
                    const headerNodes = document.querySelectorAll('#overlay-scroll-container [data-article-export-header]');
                    if (headerNodes.length) {
                        const header = parsed.createElement('header');
                        headerNodes.forEach(node => header.appendChild(node.cloneNode(true)));
                        article.replaceChildren(header, content);
                        const source = parsed.createElement('a');
                        source.className = 'pdf-source';
                        source.href = this.articleReaderUrl(this.overlayArticle) || window.location.href;
                        source.textContent = source.href;
                        article.appendChild(source);
                    }

                    article.querySelectorAll('script, style, noscript, template, form, button').forEach(node => node.remove());
                    article.querySelectorAll('img').forEach(image => {
                        // Lazy images on later thread pages must also load before printing.
                        image.removeAttribute('loading');
                        image.removeAttribute('srcset');
                    });
                    article.querySelectorAll('*').forEach(node => {
                        for (const attribute of [...node.attributes]) {
                            if (/^on|^x-|^@|^:/i.test(attribute.name)) node.removeAttribute(attribute.name);
                        }
                    });
                    return { ...payload, html: article.outerHTML };
                },

                cancelArticlePdf(options = {}) {
                    const silent = options?.silent === true;
                    const controller = this.articlePdfAbortController;
                    if (controller) {
                        controller.cancelServerJob = !silent;
                        controller.abort();
                    }
                    if (!silent && this.articlePdfJobId) {
                        fetch('/api/article-pdf/' + this.articlePdfJobId, { method: 'DELETE' }).catch(() => {});
                    }
                    this.articlePdfAbortController = null;
                    this.articlePdfJobId = null;
                    if (this.articlePdfResetTimer) clearTimeout(this.articlePdfResetTimer);
                    this.articlePdfResetTimer = null;
                    this.articlePdfState = 'idle';
                    this.articlePdfProgress = { current: 0, total: 0, message: silent ? '' : 'PDF generation paused. Download again to resume.' };
                },

                vozPdfPageUrl(baseUrl, page) {
                    return this.vozThreadPageUrlFrom(baseUrl, page);
                },

                vozPdfBaseUrl(article = this.overlayArticle) {
                    const raw = this.articleReaderUrl(article) || article?.link || article?.originalLink || '';
                    try {
                        const url = new URL(raw, window.location.origin);
                        url.hash = '';
                        url.search = '';
                        url.pathname = url.pathname
                            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
                            .replace(/\/$/, '');
                        return url.href.replace(/\/$/, '');
                    } catch (error) {
                        return raw.replace(/[?#].*$/, '').replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '').replace(/\/$/, '');
                    }
                },

                async fetchVozPdfPage(url, page, signal, options = {}) {
                    const currentPage = Number(this.overlayPagination?.currentPage || 1);
                    if (options.force !== true && page === currentPage && this.overlayContent) {
                        return {
                            url: this.articleReaderUrl(this.overlayArticle) || url,
                            content: this.overlayContent,
                            pagination: this.overlayPagination,
                            cached: this.overlayFetchedFromCache
                        };
                    }
                    const params = new URLSearchParams({
                        url,
                        title: this.overlayArticle?.overlayTitle || this.overlayArticle?.title || '',
                        feedTitle: this.overlayArticle?.feedTitle || 'VOZ',
                        feedUrl: this.overlayArticle?.feedUrl || ''
                    });
                    if (options.force === true) params.set('bypassCache', '1');
                    const response = await fetch('/api/article-content?' + params.toString(), { signal });
                    if (!response.ok) throw new Error(`Page ${page} returned HTTP ${response.status}`);
                    const data = await response.json();
                    if (data.error) throw new Error(data.error);
                    return data;
                },

                async collectVozThreadForPdf(signal) {
                    const baseUrl = this.vozPdfBaseUrl();
                    if (!baseUrl) throw new Error('The VOZ thread URL is unavailable.');
                    const initialPages = this.overlayPagination?.pages || [];
                    let totalPages = Math.max(
                        1,
                        Number(this.overlayPagination?.currentPage || 1),
                        ...initialPages.map(item => Number(item?.page || 0))
                    );
                    const collected = [];
                    const seenPosts = new Set();
                    const failedPages = [];

                    for (let page = 1; page <= totalPages; page++) {
                        if (signal.aborted) throw new DOMException('PDF preparation cancelled.', 'AbortError');
                        this.articlePdfProgress = {
                            current: page - 1,
                            total: totalPages,
                            message: `Fetching VOZ page ${page} of ${totalPages}…`
                        };
                        let data;
                        try {
                            data = await this.fetchVozPdfPage(this.vozPdfPageUrl(baseUrl, page), page, signal);
                        } catch (error) {
                            if (error?.name === 'AbortError') throw error;
                            failedPages.push(page);
                            this.articlePdfProgress = {
                                current: page,
                                total: totalPages,
                                message: `Page ${page} is unavailable; continuing with cached pages…`
                            };
                            continue;
                        }

                        const paginationPages = data.pagination?.pages || [];
                        totalPages = Math.max(
                            totalPages,
                            Number(data.pagination?.currentPage || page),
                            ...paginationPages.map(item => Number(item?.page || 0))
                        );
                        const nextPage = this.vozThreadPageNumberFromUrl(data.pagination?.nextUrl || '');
                        if (nextPage) totalPages = Math.max(totalPages, Number(nextPage));

                        let parsed = new DOMParser().parseFromString(`<main>${data.content || ''}</main>`, 'text/html');
                        let posts = [...parsed.querySelectorAll('.voz-post')];
                        if (posts.length < 20 && page < totalPages && data.sourceDeleted !== true) {
                            this.articlePdfProgress = {
                                current: page - 1,
                                total: totalPages,
                                message: `Refreshing incomplete VOZ page ${page} of ${totalPages}…`
                            };
                            try {
                                data = await this.fetchVozPdfPage(this.vozPdfPageUrl(baseUrl, page), page, signal, { force: true });
                                parsed = new DOMParser().parseFromString(`<main>${data.content || ''}</main>`, 'text/html');
                                posts = [...parsed.querySelectorAll('.voz-post')];
                            } catch (error) {
                                if (error?.name === 'AbortError') throw error;
                                // Keep the valid cached posts if a refresh fails.
                            }
                        }
                        const uniquePosts = [];
                        for (const post of posts) {
                            const identity = post.dataset.absolutePostId
                                || post.dataset.postIndex
                                || post.id
                                || post.textContent?.trim().slice(0, 180);
                            if (!identity || seenPosts.has(identity)) continue;
                            seenPosts.add(identity);
                            uniquePosts.push(post.outerHTML);
                        }
                        if (uniquePosts.length) {
                            collected.push(`<section class="pdf-thread-page" data-page="${page}"><h2>Page ${page}</h2>${uniquePosts.join('')}</section>`);
                        }
                        this.articlePdfProgress = {
                            current: page,
                            total: totalPages,
                            message: `Fetched page ${page} of ${totalPages} · ${seenPosts.size} posts`
                        };
                    }

                    if (!seenPosts.size) throw new Error('No VOZ posts were available to save.');
                    if (failedPages.length) {
                        collected.unshift(`<p class="pdf-warning">Pages unavailable: ${failedPages.join(', ')}. The PDF contains every page available from the normal article cache.</p>`);
                    }
                    return collected.join('\n');
                },

                articlePrintDocument(payload) {
                    const title = this.stripHtml(this.overlayArticle?.overlayTitle || this.overlayArticle?.title || 'Article');
                    const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
                    const readerContent = document.querySelector('#overlay-scroll-container .article-rendered-content');
                    const contentWidth = readerContent?.getBoundingClientRect().width || 680;
                    // Resolve responsive rules against the open reader, before the
                    // popup or A4 page can select different font sizes and spacing.
                    const snapshotRules = rules => [...rules].map(rule => {
                        if (rule.type === 4 && typeof window.matchMedia === 'function') {
                            return window.matchMedia(rule.conditionText).matches ? snapshotRules(rule.cssRules) : '';
                        }
                        if (!rule.style || !rule.selectorText) return rule.cssText;
                        const declarations = rule.style.cssText.replace(/(-?\d*\.?\d+)(vh|vw)\b/g, (_, value, unit) =>
                            `${Number(value) * (unit === 'vh' ? window.innerHeight : window.innerWidth) / 100}px`);
                        return `${rule.selectorText} { ${declarations} }`;
                    }).join('\n');
                    // Share the live styles, including Tailwind utilities used inside
                    // reaction bars. A separate print theme drifts from the reader.
                    const readerStyles = [...document.querySelectorAll('head style, head link[rel="stylesheet"]')]
                        .map(node => {
                            if (node.disabled) return '';
                            try {
                                // Inline loaded CSS so a failed fetch cannot strip the layout.
                                if (node.sheet?.cssRules) {
                                    if (node.media && typeof window.matchMedia === 'function' && !window.matchMedia(node.media).matches) return '';
                                    const style = document.createElement('style');
                                    style.textContent = snapshotRules(node.sheet.cssRules);
                                    return style.outerHTML;
                                }
                            } catch (error) { /* Cross-origin stylesheets must remain links. */ }
                            const copy = node.cloneNode(true);
                            if (copy.tagName === 'LINK') copy.setAttribute('href', node.href);
                            return copy.outerHTML;
                        }).join('\n');
                    const bodyClass = escape(`${document.body.className} article-print-document`);
                    const htmlClass = escape(document.documentElement.className);
                    const background = this.theme === 'glass-light' ? '#f7f7f7' : '#1e1e1e';
                    return `<!doctype html><html id="article-print-root" class="${htmlClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>${readerStyles}<style>
                        @page { size: A4; margin: 14mm 13mm 16mm; }
                        html, body { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
                        html#article-print-root, html#article-print-root body.article-print-document { margin: 0 !important; background: ${background} !important; background-image: none !important; background-attachment: scroll !important; }
                        #article-print-root #overlay-scroll-container { overflow: visible !important; scrollbar-gutter: auto; }
                        *, *::before, *::after { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        .article-print { box-sizing: border-box; width: ${contentWidth + 80}px; max-width: 100%; margin: 0 auto; padding: 32px 40px; }
                        .article-print h1, .article-print h2, .article-print h3 { break-after: avoid; }
                        .article-print pre, .article-print code { white-space: pre-wrap; overflow-wrap: anywhere; }
                        .article-print figure { break-inside: avoid; }
                        .article-print .voz-post { break-inside: auto; }
                        .article-print .voz-post-header { break-after: avoid; }
                        .article-print .voz-post-likes { break-before: avoid; }
                        .article-print .voz-post .voz-like-icon { width: 18px !important; height: 18px !important; max-height: 18px !important; flex-shrink: 0 !important; }
                        .article-print .voz-post .bbCodeBlock--spoiler .bbCodeBlock-content { filter: none !important; opacity: 1 !important; max-height: none !important; overflow: visible !important; }
                        .article-print .voz-post .bbCodeBlock--spoiler::before { content: "Spoiler" !important; }
                        .article-print .pdf-thread-page > h2 { font-size: 14px; opacity: 0.65; margin: 24px 0 12px; }
                        .article-print .pdf-thread-page:first-of-type > h2 { display: none; }
                        .pdf-source { display: block; margin-top: 24px; font-size: 12px; opacity: 0.65; overflow-wrap: anywhere; }
                        .pdf-warning { padding: 12px 16px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; }
                        iframe, video, audio, button, form { display: none !important; }
                        @media print {
                            .article-print { width: ${contentWidth + 8}px; padding: 0 4px; }
                            .pdf-thread-page + .pdf-thread-page { break-before: page; }
                        }
                    </style></head><body class="${bodyClass}"><main id="overlay-scroll-container">${payload.html}</main></body></html>`;
                },

                async waitForArticlePrintAssets(printWindow) {
                    let timeout;
                    try {
                        await Promise.race([
                            (async () => {
                                if (printWindow.document.readyState !== 'complete') {
                                    await new Promise(resolve => printWindow.addEventListener('load', resolve, { once: true }));
                                }
                                await printWindow.document.fonts?.ready;
                                await Promise.all([...printWindow.document.images].map(image => image.complete
                                    ? Promise.resolve()
                                    : new Promise(resolve => {
                                        image.addEventListener('load', resolve, { once: true });
                                        image.addEventListener('error', resolve, { once: true });
                                    })));
                            })(),
                            new Promise(resolve => { timeout = setTimeout(resolve, 8_000); })
                        ]);
                    } finally {
                        clearTimeout(timeout);
                    }
                },

                async requestArticlePdf(url, options = {}) {
                    for (let attempt = 0; attempt < 4; attempt++) {
                        try {
                            const response = await fetch(url, options);
                            if (response.status === 401) throw new Error('Please sign in again to download your PDF.');
                            const text = await response.text();
                            let job;
                            try { job = JSON.parse(text); }
                            catch {
                                const error = new Error('The PDF server is temporarily unavailable. Please try again shortly.');
                                error.retryable = true;
                                throw error;
                            }
                            if (!response.ok) {
                                const error = new Error(job.error || 'Could not check PDF generation.');
                                error.retryable = response.status >= 500;
                                throw error;
                            }
                            return job;
                        } catch (error) {
                            if (options.signal?.aborted) throw error;
                            if (attempt === 3 || (!error.retryable && error.name !== 'TypeError')) throw error;
                            this.articlePdfProgress.message = 'Reconnecting to PDF generation on the server…';
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                },

                async saveArticleAsPdf(regenerate = false) {
                    if (this.articlePdfState === 'preparing') { this.cancelArticlePdf(); return; }
                    if (!this.overlayArticle || !this.overlayContent) return;
                    const controller = new AbortController();
                    this.articlePdfAbortController = controller;
                    this.articlePdfJobId = null;
                    this.articlePdfState = 'preparing';
                    this.articlePdfProgress = { current: 0, total: 0, message: 'Preparing PDF on the server. You can close the reader and return later.' };
                    try {
                        let job = await this.requestArticlePdf('/api/article-pdf', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                url: this.isVozArticle(this.overlayArticle) ? this.vozPdfBaseUrl() : this.articleReaderUrl(this.overlayArticle),
                                regenerate, regenerationKey: regenerate ? crypto.randomUUID() : null,
                                title: this.overlayArticle.overlayTitle || this.overlayArticle.title || '',
                                feedUrl: this.overlayArticle.feedUrl || '',
                                totalPages: Math.max(1, Number(this.overlayPagination?.currentPage || 1), ...(this.overlayPagination?.pages || []).map(p => Number(p.page) || 1))
                            })
                        });
                        if (job.error) throw new Error(job.error || 'Could not start PDF generation.');
                        if (controller.signal.aborted) {
                            if (controller.cancelServerJob) await fetch('/api/article-pdf/' + job.id, { method: 'DELETE' });
                            return;
                        }
                        this.articlePdfJobId = job.id;
                        while (!controller.signal.aborted) {
                            this.articlePdfProgress = { current: job.current || 0, total: job.total || 0, message: job.message || 'Preparing PDF on the server…' };
                            if (job.status === 'ready' && job.downloadUrl) {
                                const link = document.createElement('a');
                                link.href = job.downloadUrl;
                                link.download = '';
                                document.body.appendChild(link); link.click(); link.remove();
                                this.articlePdfState = 'ready';
                                this.articlePdfProgress.message = 'Complete PDF saved on the server. Download started.';
                                return;
                            }
                            if (['error', 'cancelled', 'expired'].includes(job.status)) throw new Error(job.error || job.message || 'PDF generation stopped.');
                            await new Promise(resolve => {
                                const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
                                const timer = setTimeout(done, 2000);
                                controller.signal.addEventListener('abort', done, { once: true });
                            });
                            if (controller.signal.aborted) return;
                            job = await this.requestArticlePdf('/api/article-pdf/' + job.id, { signal: controller.signal });
                        }
                    } catch (error) {
                        if (controller.signal.aborted) return;
                        this.articlePdfState = 'error';
                        this.articlePdfProgress = { current: 0, total: 0, message: error.message || 'Could not generate the PDF. Download again to retry.' };
                    } finally {
                        if (this.articlePdfAbortController === controller) this.articlePdfAbortController = null;
                    }
                },

                copyArticleHtmlLegacy(html) {
                    if (!html || typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
                    const container = document.createElement('div');
                    container.contentEditable = 'true';
                    container.setAttribute('aria-hidden', 'true');
                    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;user-select:text;';
                    container.innerHTML = html;
                    document.body.appendChild(container);
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(container);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    let copied = false;
                    try { copied = document.execCommand('copy'); } catch (error) { }
                    selection.removeAllRanges();
                    container.remove();
                    return copied;
                },

                async copyArticleContent() {
                    if (this.articleCopyState === 'copying') return;
                    const payload = this.buildArticleClipboardPayload();
                    if (!payload) {
                        this.setArticleCopyState('error');
                        return;
                    }
                    this.setArticleCopyState('copying');
                    try {
                        if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
                            await navigator.clipboard.write([new ClipboardItem({
                                'text/html': new Blob([payload.html], { type: 'text/html' }),
                                'text/plain': new Blob([payload.text], { type: 'text/plain' })
                            })]);
                        } else if (!this.copyArticleHtmlLegacy(payload.html)) {
                            if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
                            await navigator.clipboard.writeText(payload.text);
                        }
                        this.setArticleCopyState('success');
                    } catch (error) {
                        try {
                            if (this.copyArticleHtmlLegacy(payload.html)) {
                                this.setArticleCopyState('success');
                                return;
                            }
                            if (navigator.clipboard?.writeText) {
                                await navigator.clipboard.writeText(payload.text);
                                this.setArticleCopyState('success');
                                return;
                            }
                        } catch (fallbackError) { }
                        this.setArticleCopyState('error');
                    }
                },
        };
    }
};

import { safeHttpUrl, isInvalidImage, extractImageFromHtml, escapeHtml } from '../utils/article-utils.js';
import { decodeHTMLEntities, normalizeArticleTitle } from '../../feed-parsers.js';
import { discardResponseBody, createTrackedFetch } from '../fetch-response.js';
import { isDeletedArticlePayload, deletedSourceKind, deletedSourceTitle } from '../article-source-state.js';
import sourceRegistry from '../sources/index.js';
import { extractBalancedElementByClass, selectBestArticleMarkup, scoreArticleMarkup, cleanArticleMarkup, isMalformedArticleMarkup } from './markup.js';
import { isUnsafeVozThreadPayload } from '../voz-thread-state.js';
import { normalizeArticleMediaMarkup } from '../../article-media.js';

export function createArticleParser({
    updateArticleFetchProgress,
    fetchViaJina,
    recordArticleFetchOutcome,
    finishArticleFetchProgress,
    cacheArticleResult,
    fetchViaOpenCli,
} = {}) {
    async function discoverArticleAudioUrls(html, pageUrl) {
        const discovered = [];
        const addUrl = value => {
            if (!value) return;
            try {
                const resolved = safeHttpUrl(new URL(decodeHTMLEntities(value), pageUrl).href);
                if (resolved && !discovered.includes(resolved)) discovered.push(resolved);
            } catch (e) { }
        };

        for (const match of String(html || '').matchAll(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi)) {
            for (const source of match[0].matchAll(/\s(?:src|data-src|data-url)=(['"])([\s\S]*?)\1/gi)) addUrl(source[2]);
        }
        for (const meta of String(html || '').matchAll(/<meta\b[^>]*(?:property|name)=(['"])(?:og:audio|twitter:player:stream)\1[^>]*>/gi)) {
            const content = meta[0].match(/\scontent=(['"])([\s\S]*?)\1/i);
            if (content) addUrl(content[2]);
        }

        // Several Vietnamese publishers use the shared VCCorp embedTTS player.
        // Its audio URL is assembled at runtime, so reconstruct and verify it.
        const ttsBlock = String(html || '').match(/embedTTS\.init\s*\(\s*\{([\s\S]{0,5000}?)\}\s*\)/i)?.[1] || '';
        if (ttsBlock) {
            const option = (name, fallback = '') => {
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return ttsBlock.match(new RegExp('(?:^|[,\\n\\r])\\s*' + escaped + '\\s*:\\s*(["\\\'])([\\s\\S]*?)\\1', 'i'))?.[2] || fallback;
            };
            const newsId = option('newsId');
            const distributionDate = option('distributionDate');
            const namespace = option('nameSpace');
            const domainStorage = option('domainStorage', 'https://tts.mediacdn.vn').replace(/\/$/, '');
            const ext = option('ext', 'm4a');
            const voice = option('defaultVoice', 'nu');
            const format = option('srcAudioFormat', '{0}/{1}/{2}-{3}-{4}.{5}');
            const apiCheck = option('apiCheckUrlExists');
            if (newsId && distributionDate && namespace) {
                // VCCorp's placeholders are namespace, voice, then article id.
                // Keep the historical ordering as a fallback for other deployments.
                const valueOrders = [
                    [domainStorage, distributionDate, namespace, voice, newsId, ext],
                    [domainStorage, distributionDate, namespace, newsId, voice, ext]
                ];
                const candidates = [...new Set(valueOrders.map(values =>
                    format.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)] || '')
                ))];
                for (const candidate of candidates) {
                    let exists = false;
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 4500);
                    try {
                        if (apiCheck) {
                            const filename = candidate.startsWith(domainStorage + '/') ? candidate.slice(domainStorage.length + 1) : candidate;
                            const response = await fetch(apiCheck + (apiCheck.includes('?') ? '&' : '?') + 'filename=' + encodeURIComponent(filename), {
                                headers: { Referer: pageUrl, Origin: new URL(pageUrl).origin },
                                signal: controller.signal
                            });
                            const result = response.ok ? await response.json() : null;
                            if (!response.ok) await discardResponseBody(response);
                            exists = Boolean(result && Number(result.status) === 1);
                        } else {
                            const response = await fetch(candidate, { method: 'HEAD', signal: controller.signal });
                            exists = response.ok;
                            await discardResponseBody(response);
                        }
                    } catch (e) { }
                    finally { clearTimeout(timeout); }
                    if (exists) {
                        addUrl(candidate);
                        break;
                    }
                }
            }
        }

        return discovered.slice(0, 3);
    }

    async function parseArticleHtmlContent(html, url, htmlStrategy, attemptedStrategiesInput = [], availableStrategies = [], methodPreferences = {}, requestId = null, excludedStrategiesInput = new Set()) {
        const attemptedStrategies = attemptedStrategiesInput instanceof Set ? attemptedStrategiesInput : new Set(attemptedStrategiesInput || []);
        const excludedStrategies = excludedStrategiesInput instanceof Set ? excludedStrategiesInput : new Set(excludedStrategiesInput || []);
        let hostname = '';
        try { hostname = new URL(url).hostname.toLowerCase(); } catch (e) { }
        if (requestId) updateArticleFetchProgress(requestId, 'extracting', 'Finding the article body, images, and video…');

        // A deleted source is a terminal state, not an extraction failure. Return
        // it before any clean-reader fallback can erase the flag or replace the
        // last-known-good cache with a publisher's error page.
        if (isDeletedArticlePayload(url, html)) {
            const kind = deletedSourceKind(url);
            return {
                url,
                title: deletedSourceTitle(url),
                author: '',
                date: '',
                image: '',
                siteName: hostname.replace(/^www\./, ''),
                content: '',
                isDeletedSource: true,
                isDeletedThread: kind === 'thread',
                fetchStrategy: htmlStrategy || 'none',
                attemptedStrategies: [...attemptedStrategies],
                availableStrategies,
                methodPreferences
            };
        }

        const pageAudioUrls = await discoverArticleAudioUrls(html, url);

        let sourceHandler = sourceRegistry.getHandler(url);
        const sourceFetches = createTrackedFetch((url, options, timeout = 8000) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
        });
        const fetchWithTimeout = sourceFetches.fetch;
        if (sourceHandler && sourceHandler.preProcessHtml) {
            try {
                html = await sourceHandler.preProcessHtml(html, { fetchWithTimeout });
            } finally {
                await sourceFetches.discardUnread();
            }
        }


        // Extract metadata from meta tags
        const result = { url };
        const metaTags = html.match(/<meta[^>]+>/ig) || [];
        for (const tag of metaTags) {
            const contentMatch = tag.match(/content=(["'])([\s\S]*?)\1/i);
            if (!contentMatch) continue;
            const c = contentMatch[2].trim();
            if (/og:title/i.test(tag) && !result.title) result.title = decodeHTMLEntities(c);
            if (/og:image/i.test(tag) && !tag.match(/og:image:(width|height|type|alt)/i) && !result.image && !isInvalidImage(c) && !c.includes('avplayer.com')) result.image = c;
            if (/og:site_name/i.test(tag) && !result.siteName) result.siteName = decodeHTMLEntities(c);
            if (/og:description/i.test(tag) && !result.description) result.description = decodeHTMLEntities(c);
            if (/(article:published_time|datepublished)/i.test(tag) && !result.date) result.date = c;
            if (/author/i.test(tag) && !result.author) result.author = decodeHTMLEntities(c);
        }

        // Fallback title from <title> tag
        if (!result.title) {
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            if (titleMatch) result.title = decodeHTMLEntities(titleMatch[1].trim());
        }

        // Fallback image
        if (!result.image || isInvalidImage(result.image) || result.image.includes('avplayer.com')) {
            const extracted = extractImageFromHtml(html, url);
            if (extracted && !isInvalidImage(extracted) && !extracted.includes('avplayer.com')) {
                result.image = extracted;
            }
        }

        if (result.siteName === 'VOZ' || (url && url.includes('voz.vn'))) {
            result.image = null;
        }

        // Extract author from JSON-LD
        const ldJsonMatches = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig) || [];
        for (const block of ldJsonMatches) {
            try {
                const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').replace(/[\n\r\t]+/g, ' ').trim();
                const parsed = JSON.parse(cleanJson);
                const schemas = [];
                const schemaQueue = Array.isArray(parsed) ? [...parsed] : [parsed];
                while (schemaQueue.length) {
                    const schema = schemaQueue.shift();
                    if (!schema || typeof schema !== 'object') continue;
                    schemas.push(schema);
                    for (const value of Object.values(schema)) {
                        if (Array.isArray(value)) {
                            for (const item of value) if (item && typeof item === 'object') schemaQueue.push(item);
                        } else if (value && typeof value === 'object') {
                            schemaQueue.push(value);
                        }
                    }
                }
                for (const schema of schemas) {
                    const schemaTypes = Array.isArray(schema['@type']) ? schema['@type'] : [schema['@type']];
                    const structuredTitle = schema.headline || (schemaTypes.some(type => /Article$/i.test(type || '')) ? schema.name : '');
                    if (structuredTitle) {
                        const decodedTitle = decodeHTMLEntities(String(structuredTitle).trim());
                        if (!result.title || decodedTitle.length >= result.title.length) result.title = decodedTitle;
                    }
                    if (!result.author && schema.author) {
                        result.author = typeof schema.author === 'string' ? schema.author : (schema.author.name || (Array.isArray(schema.author) ? schema.author[0]?.name : ''));
                    }
                    if (!result.date && schema.datePublished) result.date = schema.datePublished;
                    if (schema.articleBody) result.articleBody = schema.articleBody;
                    if (schemaTypes.includes('VideoObject')) {
                        const rawVideoUrl = Array.isArray(schema.contentUrl) ? schema.contentUrl[0] : schema.contentUrl;
                        const videoUrl = safeHttpUrl(rawVideoUrl || schema.embedUrl || schema.encoding?.contentUrl || '');
                        if (videoUrl && /\.(?:m3u8|mp4|webm|ogg)(?:$|[?#])/i.test(videoUrl)) {
                            const thumbnail = Array.isArray(schema.thumbnailUrl) ? schema.thumbnailUrl[0] : schema.thumbnailUrl;
                            const video = {
                                url: videoUrl,
                                poster: safeHttpUrl(thumbnail || ''),
                                title: String(schema.name || schema.headline || '').trim()
                            };
                            result.videos ||= [];
                            if (!result.videos.some(item => item.url === video.url)) result.videos.push(video);
                        }
                    }
                }
            } catch (e) { }
        }

        if (result.videos?.length) {
            result.videoUrl = result.videos[0].url;
            result.videoPoster = result.videos[0].poster;
        }

        // Extract main article content using common selectors via regex
        let articleHtml = '';

        let isCustomSource = false;
        sourceHandler = sourceRegistry.getHandler(url);
        if (sourceHandler && sourceHandler.parseArticleHtmlContent) {
            try {
                const parsedContent = sourceHandler.parseArticleHtmlContent(html, url, result, { escapeHtml, extractBalancedElementByClass, fetchWithTimeout });
                const resolvedContent = parsedContent instanceof Promise ? await parsedContent : parsedContent;
                if (resolvedContent !== false) {
                    articleHtml = resolvedContent;
                    isCustomSource = true;
                }
            } finally {
                await sourceFetches.discardUnread();
            }
        }

        if (!isCustomSource) {
            const sapoMatch = html.match(/<(?:h[1-6]|div|p)\b[^>]*class=["'][^"']*(?:content-detail-sapo|article-sapo|singular-sapo|story-sapo|detail-sapo|sapo)[^"']*["'][^>]*>([\s\S]{0,5000}?)<\/(?:h[1-6]|div|p)>/i);
            const sapoHtml = sapoMatch && sapoMatch[1].replace(/<[^>]+>/g, '').trim().length > 30 ? `<p class="article-sapo font-semibold text-lg mb-4 text-gray-800 dark:text-gray-200 leading-relaxed">${sapoMatch[1].trim()}</p>` : '';

            articleHtml = selectBestArticleMarkup(html);
            if (sapoHtml && articleHtml && !articleHtml.includes(sapoHtml.slice(0, 40))) {
                articleHtml = sapoHtml + '\n' + articleHtml;
            }
            if (!articleHtml || scoreArticleMarkup(cleanArticleMarkup(articleHtml)) < 250) {
                const articleSelectors = [
                    /<article\b[^>]*>([\s\S]{0,100000}?)<\/article>/i,
                    /<main\b[^>]*>([\s\S]{0,100000}?)<\/main>/i,
                    /<div\b[^>]*class=["'][^"']*(?:article|post|content|entry-content|post-content|article-body|story-body)[^"']*["'][^>]*>([\s\S]{0,100000}?)<\/div>/i,
                    /<section\b[^>]*class=["'][^"']*(?:article|post|content|entry-content|post-content|article-body)[^"']*["'][^>]*>([\s\S]{0,100000}?)<\/section>/i
                ];
                for (const regex of articleSelectors) {
                    const match = html.match(regex);
                    if (match) {
                        const captured = match[1] || match[0];
                        const textOnly = captured.replace(/<[^>]+>/g, '').trim();
                        if (textOnly.length > 200) {
                            articleHtml = (sapoHtml ? sapoHtml + '\n' : '') + captured;
                            break;
                        }
                    }
                }
            }
        }

            // General final backup for pages whose HTML loaded but whose article
            // body could not be extracted reliably.
            if (!articleHtml && !attemptedStrategies.has('jina') && !excludedStrategies.has('jina')) {
                try {
                    attemptedStrategies.add('jina');
                    updateArticleFetchProgress(requestId, 'fallback', 'The page layout was unusual; trying the clean text reader…');
                    const jinaResult = await fetchViaJina(url);
                    if (isDeletedArticlePayload(url, jinaResult)) {
                        return { url, ...jinaResult, fetchStrategy: 'jina', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    }
                    if (htmlStrategy) await recordArticleFetchOutcome(hostname, htmlStrategy, false, 'HTML loaded but article body extraction failed');
                    await recordArticleFetchOutcome(hostname, 'jina', true);
                    finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'jina' });
                    const payload = { url, ...jinaResult, fetchStrategy: 'jina', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    await cacheArticleResult(url, payload);
                    return payload;
                } catch (error) {
                    await recordArticleFetchOutcome(hostname, 'jina', false, error.message);
                }
            }

            if (!articleHtml && !attemptedStrategies.has('opencli') && !excludedStrategies.has('opencli')) {
                try {
                    attemptedStrategies.add('opencli');
                    updateArticleFetchProgress(requestId, 'fallback', 'Trying the browser reader as the final backup…');
                    const openCliResult = await fetchViaOpenCli(url, requestId);
                    if (isDeletedArticlePayload(url, openCliResult)) {
                        return { url, ...openCliResult, content: '', isDeletedSource: true, isDeletedThread: deletedSourceKind(url) === 'thread', fetchStrategy: 'opencli', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    }
                    if (isUnsafeVozThreadPayload(url, openCliResult)) throw new Error('OpenCLI returned a VOZ error page');
                    await recordArticleFetchOutcome(hostname, 'opencli', true);
                    finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'opencli' });
                    const payload = { url, ...openCliResult, fetchStrategy: 'opencli', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    await cacheArticleResult(url, payload);
                    return payload;
                } catch (error) {
                    await recordArticleFetchOutcome(hostname, 'opencli', false, error.message);
                }
            }

            // Fallback: if we have articleBody from JSON-LD, wrap it in <p> tags
            if (!articleHtml && result.articleBody) {
                articleHtml = result.articleBody.split(/\n\n+/).map(p => `<p>${p.trim()}</p>`).join('');
            }

            // Fallback: use description/content snippet
            if (!articleHtml && result.description) {
                articleHtml = `<p>${result.description}</p>`;
            }

            updateArticleFetchProgress(requestId, 'cleaning', 'Cleaning spacing and removing unrelated page content…');
            if (!isCustomSource) {
                articleHtml = cleanArticleMarkup(articleHtml);
            } else {
                // Only strip scripts, styles, forms, and template tags for custom sources to preserve specialized markup
                articleHtml = articleHtml.replace(/<(?:script|style|template|nav|form|noscript)\b[^>]*>[\s\S]{0,50000}?<\/(?:script|style|template|nav|form|noscript)>/gi, '');
            }

            if (!result.videos?.length) {
                const vidMatches = [...articleHtml.matchAll(/<video\b[^>]*\bsrc=(["'])(https?:\/\/[^"']+)\1[^>]*>/gi)];
                for (const m of vidMatches) {
                    const vUrl = safeHttpUrl(m[2]);
                    if (vUrl) {
                        result.videos ||= [];
                        if (!result.videos.some(item => item.url === vUrl)) result.videos.push({ url: vUrl, title: result.title || 'Video' });
                    }
                }
                if (result.videos?.length) {
                    result.videoUrl = result.videos[0].url;
                    if (!result.videoPoster) {
                        const posterMatch = articleHtml.match(/<video\b[^>]*\bposter=(["'])(https?:\/\/[^"']+)\1/i);
                        if (posterMatch) result.videoPoster = safeHttpUrl(posterMatch[2]);
                    }
                }
            }

            const preliminaryTextLength = articleHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
            const hasPreliminaryMedia = /<(?:img|picture|video|audio|iframe)\b/i.test(articleHtml);
            const malformedArticleMarkup = isMalformedArticleMarkup(articleHtml);
            if ((malformedArticleMarkup || (preliminaryTextLength < 200 && !hasPreliminaryMedia)) && !attemptedStrategies.has('jina') && !excludedStrategies.has('jina')) {
                try {
                    attemptedStrategies.add('jina');
                    updateArticleFetchProgress(requestId, 'fallback', 'The first result was incomplete; trying the clean text reader…');
                    const jinaResult = await fetchViaJina(url);
                    if (isDeletedArticlePayload(url, jinaResult)) {
                        return { url, ...jinaResult, fetchStrategy: 'jina', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    }
                    if (htmlStrategy) await recordArticleFetchOutcome(hostname, htmlStrategy, false, 'Extracted article fragment was incomplete');
                    await recordArticleFetchOutcome(hostname, 'jina', true);
                    finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'jina' });
                    const payload = { url, ...jinaResult, fetchStrategy: 'jina', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    await cacheArticleResult(url, payload);
                    return payload;
                } catch (error) {
                    await recordArticleFetchOutcome(hostname, 'jina', false, error.message);
                    if (malformedArticleMarkup) articleHtml = '';
                }
            }

            if ((malformedArticleMarkup || (preliminaryTextLength < 200 && !hasPreliminaryMedia)) && !attemptedStrategies.has('opencli') && !excludedStrategies.has('opencli')) {
                try {
                    attemptedStrategies.add('opencli');
                    updateArticleFetchProgress(requestId, 'fallback', 'Trying the browser reader as the final backup…');
                    const openCliResult = await fetchViaOpenCli(url, requestId);
                    if (isDeletedArticlePayload(url, openCliResult)) {
                        return { url, ...openCliResult, content: '', isDeletedSource: true, isDeletedThread: deletedSourceKind(url) === 'thread', fetchStrategy: 'opencli', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    }
                    if (isUnsafeVozThreadPayload(url, openCliResult)) throw new Error('OpenCLI returned a VOZ error page');
                    if (htmlStrategy) await recordArticleFetchOutcome(hostname, htmlStrategy, false, 'Extracted article fragment was incomplete');
                    await recordArticleFetchOutcome(hostname, 'opencli', true);
                    finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'opencli' });
                    const payload = { url, ...openCliResult, fetchStrategy: 'opencli', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                    await cacheArticleResult(url, payload);
                    return payload;
                } catch (error) {
                    await recordArticleFetchOutcome(hostname, 'opencli', false, error.message);
                    if (malformedArticleMarkup) articleHtml = '';
                }
            }

            const pendingVideos = (result.videos || []).filter(video => !articleHtml.includes(video.url));
            const renderVideo = video => {
                const poster = video.poster ? ' poster="' + escapeHtml(video.poster) + '"' : '';
                const label = video.title ? ' aria-label="' + escapeHtml(video.title) + '"' : '';
                return '<video controls playsinline preload="metadata"' + poster + label + ' src="' + escapeHtml(video.url) + '">Your browser does not support HTML5 video.</video>';
            };

            let placedVideoCount = 0;
            if (pendingVideos.length) {
                // Replace empty/custom player placeholders in document order so
                // video stays where the publisher placed it in the article.
                articleHtml = articleHtml.replace(
                    /<(div|span|b|figure)\b[^>]*class=(["'])[^"']*(?:video-element|video-player|player-video|embed-video)[^"']*\2[^>]*>[\s\S]{0,50000}?<\/\1>/gi,
                    placeholder => placedVideoCount < pendingVideos.length ? renderVideo(pendingVideos[placedVideoCount++]) : placeholder
                );

                // Some publishers use a video iframe rather than an empty player
                // placeholder. Replace only frames that identify themselves as media.
                articleHtml = articleHtml.replace(/<iframe\b[^>]*>[\s\S]{0,10000}?<\/iframe>/gi, iframe => {
                    if (placedVideoCount >= pendingVideos.length || !/(?:video|youtube|vimeo|player)/i.test(iframe)) return iframe;
                    return renderVideo(pendingVideos[placedVideoCount++]);
                });

                // If structured video metadata exists but the source has no usable
                // placeholder, keep the video available as a graceful fallback.
                if (placedVideoCount === 0 && !/<video\b/i.test(articleHtml)) {
                    articleHtml = renderVideo(pendingVideos[0]) + articleHtml;
                    placedVideoCount = 1;
                }
            }

            // Clean the extracted HTML
            if (articleHtml) {
                // Remove script/style tags
                articleHtml = articleHtml.replace(/<script[\s\S]{0,50000}?<\/script>/gi, '');
                articleHtml = articleHtml.replace(/<style[\s\S]{0,50000}?<\/style>/gi, '');

                // Promote lazy-loaded media attributes to native browser
                // attributes while preserving each element's article position.
                try {
                    const baseUrl = new URL(url);
                    const resolveMediaUrl = value => {
                        try {
                            return safeHttpUrl(new URL(decodeHTMLEntities(value), baseUrl).href);
                        } catch (e) {
                            return '';
                        }
                    };

                    articleHtml = articleHtml.replace(/<(?:img|video|audio)\b[^>]*>/gi, tag => {
                        const lazySource = tag.match(/\s(?:data-src|data-url|data-original|data-original-src|data-lazy-src)=(["'])([\s\S]*?)\1/i);
                        if (lazySource) {
                            const resolved = resolveMediaUrl(lazySource[2]);
                            if (resolved) {
                                const attribute = ' src="' + escapeHtml(resolved) + '"';
                                tag = /\ssrc=(["'])([\s\S]*?)\1/i.test(tag)
                                    ? tag.replace(/\ssrc=(["'])([\s\S]*?)\1/i, attribute)
                                    : tag.replace(/\s*\/?>$/, attribute + '>');
                            }
                        }

                        const lazyPoster = tag.match(/\sdata-poster=(["'])([\s\S]*?)\1/i);
                        if (lazyPoster) {
                            const resolvedPoster = resolveMediaUrl(lazyPoster[2]);
                            if (resolvedPoster) {
                                const attribute = ' poster="' + escapeHtml(resolvedPoster) + '"';
                                tag = /\sposter=(["'])([\s\S]*?)\1/i.test(tag)
                                    ? tag.replace(/\sposter=(["'])([\s\S]*?)\1/i, attribute)
                                    : tag.replace(/\s*\/?>$/, attribute + '>');
                            }
                        }
                        return tag;
                    });

                    articleHtml = articleHtml.replace(/<source\b[^>]*>/gi, tag => {
                        const lazySource = tag.match(/\sdata-src=(["'])([\s\S]*?)\1/i);
                        if (lazySource) {
                            const resolved = resolveMediaUrl(lazySource[2]);
                            if (resolved) {
                                const attribute = ' src="' + escapeHtml(resolved) + '"';
                                tag = /\ssrc=(["'])([\s\S]*?)\1/i.test(tag)
                                    ? tag.replace(/\ssrc=(["'])([\s\S]*?)\1/i, attribute)
                                    : tag.replace(/\s*\/?>$/, attribute + '>');
                            }
                        }

                        const lazySrcset = tag.match(/\sdata-srcset=(["'])([\s\S]*?)\1/i);
                        if (lazySrcset) {
                            const resolvedSet = lazySrcset[2].split(',').map(candidate => {
                                const parts = candidate.trim().split(/\s+/);
                                const resolved = resolveMediaUrl(parts.shift() || '');
                                return resolved ? [resolved, ...parts].join(' ') : '';
                            }).filter(Boolean).join(', ');
                            if (resolvedSet) {
                                const attribute = ' srcset="' + escapeHtml(resolvedSet) + '"';
                                tag = /\ssrcset=(["'])([\s\S]*?)\1/i.test(tag)
                                    ? tag.replace(/\ssrcset=(["'])([\s\S]*?)\1/i, attribute)
                                    : tag.replace(/\s*\/?>$/, attribute + '>');
                            }
                        }
                        return tag;
                    });
                } catch (e) { }

                articleHtml = articleHtml.replace(/<iframe\b[^>]*>[\s\S]{0,10000}?<\/iframe>/gi, (iframeMatch) => {
                    if (result.readerType === 'macstories-article'
                        && /data-macstories-widget="1"/.test(iframeMatch)
                        && /\ssandbox(?:=(["'])\1)?(?=\s|>)/i.test(iframeMatch)) return iframeMatch;
                    const srcMatch = iframeMatch.match(/\bsrc=(["'])([\s\S]*?)\1/i);
                    const src = srcMatch ? srcMatch[2].toLowerCase() : '';
                    if (!src || /(doubleclick|googlesyndication|adnxs|tracking|analytics|banner|widget\/like|fbevents)/i.test(src)) {
                        return '';
                    }
                    if (/(youtube|youtube-nocookie|youtu\.be|vimeo|tiktok|bilibili|dailymotion|facebook|instagram|twitter|x\.com|embed|player|video|tinhte\.vn)/i.test(src)) {
                        return iframeMatch;
                    }
                    return '';
                });
                // Remove inline event handlers
                articleHtml = articleHtml.replace(/\s+on\w+="[^"]*"/gi, '');
                articleHtml = articleHtml.replace(/\s+on\w+='[^']*'/gi, '');
                // Fix relative image URLs
                try {
                    const baseUrl = new URL(url);
                    articleHtml = articleHtml.replace(/src=["'](\/(?!api\/)[^"']+)["']/g, `src="${baseUrl.origin}$1"`);
                    articleHtml = articleHtml.replace(/href=["'](\/(?!api\/)[^"']+)["']/g, `href="${baseUrl.origin}$1"`);
                } catch(e) {}

                articleHtml = normalizeArticleMediaMarkup(articleHtml, url);
            }

            if (pageAudioUrls.length) {
                const missingAudio = pageAudioUrls.filter(audioUrl => !String(articleHtml || '').includes(audioUrl));
                if (missingAudio.length) {
                    const players = missingAudio.map(audioUrl => '<audio controls playsinline preload="metadata" src="' + escapeHtml(audioUrl) + '">Your browser does not support HTML5 audio.</audio>').join('');
                    articleHtml = players + (articleHtml || '');
                }
                result.audioCount = pageAudioUrls.length;
            }

            const extractedTextLength = (articleHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
            const extractionSucceeded = extractedTextLength >= 200 || /<(?:video|audio|img)\b/i.test(articleHtml || '');
            if (htmlStrategy) {
                await recordArticleFetchOutcome(
                    hostname,
                    htmlStrategy,
                    extractionSucceeded,
                    extractionSucceeded ? '' : 'HTML loaded but extracted article content was too small'
                );
            }

            result.content = articleHtml || '<p>Could not extract article content. Please open the article directly.</p>';
            result.title = normalizeArticleTitle(result.title);
            result.fetchStrategy = htmlStrategy || 'none';
            result.attemptedStrategies = [...attemptedStrategies];
            result.availableStrategies = availableStrategies;
            result.methodPreferences = methodPreferences;
            delete result.articleBody; // Don't send raw JSON-LD body

        return result;
    }

    return {
        parseArticleHtmlContent
    };
}

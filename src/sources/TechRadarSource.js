import { decodeHTML } from 'entities';
import { load } from 'cheerio';


function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}


function safeHttpUrl(value = '', baseUrl = 'https://www.techradar.com/') {
    try {
        const url = new URL(
            decodeHTML(String(value || '')),
            baseUrl
        );

        return ['http:', 'https:'].includes(url.protocol)
            ? url.href
            : '';
    } catch {
        return '';
    }
}


function escapeHtml(value = '') {
    return String(value || '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
    );
}


function extractAuthorName($) {
    /*
     * TechRadar exposes the human byline as:
     *
     *   By Christian Cawley
     *
     * while one of its metadata fields can contain the author profile URL.
     * Always prefer the visible author name.
     */
    const candidates = [
        'a[href*="/author/"]',
        '[rel="author"]',
        '[class*="author"] a',
        '[class*="byline"] a'
    ];

    for (const selector of candidates) {
        for (const node of $(selector).toArray()) {
            const name = cleanText($(node).text());

            if (
                name &&
                name.length >= 2 &&
                name.length <= 100 &&
                !/^https?:\/\//i.test(name) &&
                !/^(?:author|by)$/i.test(name)
            ) {
                return name;
            }
        }
    }

    return '';
}


function rewriteAuthorMetadata(html = '') {
    const source = String(html || '');
    if (!source) return source;

    const $ = load(source);

    const author = extractAuthorName($);

    if (!author) {
        return source;
    }

    const metadataSelectors = [
        'meta[name="author"]',
        'meta[name="parsely-author"]',
        'meta[property="author"]',
        'meta[property="article:author"]'
    ];

    for (const selector of metadataSelectors) {
        $(selector).attr(
            'content',
            author
        );
    }

    if (!$('meta[name="author"]').length) {
        $('head').append(
            `<meta name="author" content="${escapeHtml(author)}">`
        );
    }

    return $.html();
}


function findRelatedHeadings($, root, pattern) {
    return root
        .find('h2, h3, h4, div, span, p')
        .filter((_, node) =>
            pattern.test(
                cleanText($(node).text())
            )
        )
        .toArray();
}

function relatedContainerForHeading($, heading, root) {
    if (!heading?.length) {
        return null;
    }

    let current = heading.get(0);

    for (let depth = 0; depth < 7; depth++) {
        if (!current) break;

        const node = $(current);

        const links = node
            .find('a[href]')
            .toArray()
            .filter(anchor => {
                const href = safeHttpUrl(
                    $(anchor).attr('href')
                );

                return /(?:^|\.)techradar\.com$/i.test(
                    (() => {
                        try {
                            return new URL(href).hostname;
                        } catch {
                            return '';
                        }
                    })()
                );
            });

        /*
         * Current TechRadar "You may like" has three recommendations.
         * Allow a little flexibility for future layouts.
         */
        if (
            links.length >= 2 &&
            links.length <= 8 &&
            current !== root.get(0)
        ) {
            return node;
        }

        if (current === root.get(0)) {
            break;
        }

        current = current.parent;
    }

    /*
     * Common simpler structure:
     *
     * heading
     * ul
     */
    const nextList = heading.nextAll('ul, ol').first();

    if (
        nextList.length &&
        nextList.find('a[href]').length >= 2
    ) {
        return nextList;
    }

    return null;
}


function relatedArticlesFromContainer($, container) {
    if (!container?.length) {
        return [];
    }

    const articles = [];
    const seen = new Set();

    /*
     * Prefer cards/list items because their image and title usually live
     * together inside one recommendation.
     */
    let candidates = container.find(
        'li, article'
    ).toArray();

    if (!candidates.length) {
        candidates = container
            .find('a[href]')
            .toArray()
            .map(anchor => {
                const wrapper = $(anchor).closest(
                    'div, section'
                );

                return (
                    wrapper.length
                        ? wrapper.get(0)
                        : anchor
                );
            });
    }

    for (const candidate of candidates) {
        const box = $(candidate);

        let anchor = box
            .find('a[href]')
            .filter((_, node) => {
                const title = cleanText(
                    $(node).text()
                );

                return title.length >= 20;
            })
            .first();

        if (!anchor.length && box.is('a[href]')) {
            anchor = box;
        }

        if (!anchor.length) {
            continue;
        }

        const href = safeHttpUrl(
            anchor.attr('href')
        );

        if (!href) {
            continue;
        }

        let hostname = '';

        try {
            hostname = new URL(href).hostname;
        } catch {
            continue;
        }

        if (
            hostname !== 'techradar.com' &&
            !hostname.endsWith('.techradar.com')
        ) {
            continue;
        }

        if (seen.has(href)) {
            continue;
        }

        let title = cleanText(
            anchor.text()
        );

        if (title.length < 20) {
            title = cleanText(
                box.find(
                    'h2, h3, h4, [class*="title"]'
                ).first().text()
            );
        }

        if (title.length < 20) {
            continue;
        }

        let imageNode = box
            .find('img')
            .first();

        if (!imageNode.length) {
            imageNode = anchor
                .closest('div, article, li')
                .find('img')
                .first();
        }

        let image = '';

        if (imageNode.length) {
            image = safeHttpUrl(
                imageNode.attr('src') ||
                imageNode.attr('data-src') ||
                imageNode.attr('data-original-mos') ||
                ''
            );

            if (!image) {
                const srcset =
                    imageNode.attr('srcset') ||
                    imageNode.attr('data-srcset') ||
                    '';

                const first =
                    String(srcset)
                        .split(',')
                        .map(item => item.trim().split(/\s+/)[0])
                        .find(Boolean);

                image = safeHttpUrl(
                    first
                );
            }
        }

        seen.add(href);

        articles.push({
            href,
            title,
            image
        });

        if (articles.length >= 12) {
            break;
        }
    }

    /*
     * If the publisher uses separate image/title anchors, fall back to
     * unique title anchors and search their nearest card for the image.
     */
    if (articles.length < 2) {
        for (const node of container.find('a[href]').toArray()) {
            const anchor = $(node);

            const href = safeHttpUrl(
                anchor.attr('href')
            );

            const title = cleanText(
                anchor.text()
            );

            if (
                !href ||
                title.length < 20 ||
                seen.has(href)
            ) {
                continue;
            }

            let hostname = '';

            try {
                hostname = new URL(href).hostname;
            } catch {
                continue;
            }

            if (
                hostname !== 'techradar.com' &&
                !hostname.endsWith('.techradar.com')
            ) {
                continue;
            }

            const card = anchor.closest(
                'li, article, div'
            );

            const imageNode = card
                .find('img')
                .first();

            const image = imageNode.length
                ? safeHttpUrl(
                    imageNode.attr('src') ||
                    imageNode.attr('data-src') ||
                    imageNode.attr('data-original-mos') ||
                    ''
                )
                : '';

            seen.add(href);

            articles.push({
                href,
                title,
                image
            });

            if (articles.length >= 12) {
                break;
            }
        }
    }

    return articles;
}


function renderRelatedArticles(articles = []) {
    if (!articles.length) {
        return '';
    }

    const cards = articles.map(article => {
        const image = article.image
            ? (
                `<img class="embedded-suggested-image" ` +
                `src="${escapeHtml(article.image)}" ` +
                `alt="">`
            )
            : '';

        return (
            `<a class="embedded-suggested-card" ` +
            `href="${escapeHtml(article.href)}">` +
                image +
                `<div class="embedded-suggested-content">` +
                    `<div class="embedded-suggested-meta">` +
                        `<span class="embedded-suggested-category">TechRadar</span>` +
                    `</div>` +
                    `<div class="embedded-suggested-title">` +
                        escapeHtml(article.title) +
                    `</div>` +
                `</div>` +
            `</a>`
        );
    }).join('');

    /*
     * This deliberately uses the existing app classes used by
     * BÀI VIẾT LIÊN QUAN / related-story carousels.
     *
     * Existing CSS already defines:
     *   .embedded-suggested-header
     *   .embedded-suggested-header svg
     *   .embedded-suggested-carousel
     *   .embedded-suggested-card
     */
    const icon =
        `<svg viewBox="0 0 24 24" aria-hidden="true" ` +
        `focusable="false">` +
            `<rect x="2" y="2" width="20" height="20" rx="2" ` +
            `fill="currentColor"></rect>` +
            `<path d="M7 7h10M7 12h10M7 17h7" ` +
            `fill="none" stroke="white" stroke-width="2" ` +
            `stroke-linecap="round"></path>` +
        `</svg>`;

    return (
        `<section class="embedded-suggested-articles techradar-related">` +
            `<div class="embedded-suggested-header">` +
                icon +
                `<span>Related articles</span>` +
            `</div>` +
            `<div class="embedded-suggested-carousel">` +
                cards +
            `</div>` +
        `</section>`
    );
}

function collectAndRemoveRelatedSections($, root) {
    const output = [];
    const seen = new Set();

    const groups = [
        /^you may like$/i,
        /^what to read next$/i
    ];

    for (const pattern of groups) {
        const headings =
            findRelatedHeadings(
                $,
                root,
                pattern
            );

        for (const headingNode of headings) {
            /*
             * The heading may already have disappeared when a parent
             * recommendation container from an earlier match was removed.
             */
            if (!headingNode.parent) {
                continue;
            }

            const heading =
                $(headingNode);

            const container =
                relatedContainerForHeading(
                    $,
                    heading,
                    root
                );

            if (!container?.length) {
                heading.remove();
                continue;
            }

            const articles =
                relatedArticlesFromContainer(
                    $,
                    container
                );

            for (const article of articles) {
                if (
                    !article?.href ||
                    seen.has(article.href)
                ) {
                    continue;
                }

                seen.add(
                    article.href
                );

                output.push(
                    article
                );
            }

            /*
             * Remove TechRadar's own presentation completely.
             * We re-render the stories once, at the bottom.
             */
            container.remove();
        }
    }

    return output;
}

function removeGoogleNewsPromotion($, root) {

    // TECHRADAR_GOOGLE_PROMO_ORPHAN_V31
    //
    // Future/TechRadar splits:
    //
    //   Follow TechRadar on Google News
    //   and
    //   add us as a preferred source ...
    //
    // across nested elements/text nodes. Remember that this was a promo
    // before removing its identifiable children so the orphan connective
    // word and its large layout wrapper can also be removed.
    const hadGoogleNewsPromo =
        root.find(
            'a[href*="news.google.com"], ' +
            'a[href*="google.com/preferences/source"]'
        ).length > 0 ||
        root.find(
            'img[alt*="follow" i], ' +
            'img[alt*="TechRadar" i]'
        ).length > 0 ||
        /Follow TechRadar on Google News|add us as a preferred source/i.test(
            cleanText(root.text())
        );


    const promoText =
        /(?:Follow TechRadar on Google News|add us as a preferred source|(?:and\s+)?to get our expert news,\s*reviews,\s*and opinion in your feeds|expert news,\s*reviews,\s*and opinion in your feeds)/i;

    /*
     * Start with Google News links and walk upward until the smallest
     * sensible promo wrapper is found.
     */
    root
        .find(
            'a[href*="news.google.com"], ' +
            'a[href*="google.com/preferences/source"]'
        )
        .each((_, anchor) => {
            const link = $(anchor);

            let current =
                link.get(0);

            for (
                let depth = 0;
                depth < 7;
                depth++
            ) {
                if (!current) {
                    break;
                }

                const box =
                    $(current);

                const text =
                    cleanText(
                        box.text()
                    );

                if (
                    current !== root.get(0) &&
                    promoText.test(text) &&
                    text.length < 1800
                ) {
                    box.remove();
                    return;
                }

                if (
                    current === root.get(0)
                ) {
                    break;
                }

                current =
                    current.parent;
            }

            link.remove();
        });


    /*
     * Remove image-only half of the promo.
     */
    root
        .find('img')
        .each((_, node) => {
            const image =
                $(node);

            const alt =
                cleanText(
                    image.attr('alt') ||
                    ''
                );

            const src =
                String(
                    image.attr('src') ||
                    image.attr('data-src') ||
                    ''
                );

            if (
                /click to follow techradar/i.test(alt) ||
                (
                    /google/i.test(src) &&
                    /follow|preferred|news/i.test(src)
                )
            ) {
                const wrapper =
                    image.closest(
                        'figure, a, picture, div, p'
                    );

                if (
                    wrapper.length
                ) {
                    wrapper.remove();
                } else {
                    image.remove();
                }
            }
        });


    /*
     * TechRadar currently splits the promo's final sentence into a
     * separate sibling. Walk deepest elements first so a small orphan
     * is removed without unnecessarily swallowing article content.
     */
    const candidates =
        root
            .find(
                'p, span, em, i, div, section, aside, figure'
            )
            .toArray()
            .reverse();

    for (const node of candidates) {
        if (!node?.parent) {
            continue;
        }

        const box =
            $(node);

        const text =
            cleanText(
                box.text()
            );

        if (
            !text ||
            text.length > 1800 ||
            !promoText.test(text)
        ) {
            continue;
        }

        box.remove();
    }


    /*
     * Final text-node cleanup for layouts where Future CMS leaves the
     * trailing phrase directly inside #article-body with no own element.
     */
    root
        .contents()
        .each((_, node) => {
            if (
                node.type !== 'text'
            ) {
                return;
            }

            const text =
                cleanText(
                    node.data ||
                    ''
                );

            if (
                promoText.test(text)
            ) {
                $(node).remove();
            }
        });


    /*
     * V3.1:
     *
     * After the recognizable Google News children are removed, Future's
     * layout can leave a text node containing only:
     *
     *     and
     *
     * inside a large promo wrapper.
     *
     * Remove the LARGEST ancestor whose entire remaining textual content
     * is only "and". This removes the empty layout box as well as the word,
     * while avoiding ordinary occurrences of "and" inside article prose.
     */
    if (hadGoogleNewsPromo) {
        const orphanTextNodes =
            root
                .find('*')
                .addBack()
                .contents()
                .toArray()
                .filter(node =>
                    node.type === 'text' &&
                    /^and$/i.test(
                        cleanText(node.data || '')
                    )
                );

        for (const textNode of orphanTextNodes) {
            if (!textNode.parent) {
                continue;
            }

            let candidate =
                textNode.parent;

            let largest =
                candidate;

            while (
                candidate &&
                candidate !== root.get(0)
            ) {
                const box =
                    $(candidate);

                const text =
                    cleanText(
                        box.text()
                    );

                if (
                    !/^and$/i.test(text)
                ) {
                    break;
                }

                /*
                 * Never swallow meaningful media/content.
                 */
                if (
                    box.find(
                        'img, video, audio, iframe, table, ul, ol, ' +
                        'blockquote, h1, h2, h3, h4'
                    ).length > 0
                ) {
                    break;
                }

                largest =
                    candidate;

                const parent =
                    candidate.parent;

                if (
                    !parent ||
                    parent === root.get(0)
                ) {
                    break;
                }

                candidate =
                    parent;
            }

            $(largest).remove();
        }


        /*
         * Also cover the rare case where "and" is a direct text child
         * of the article root rather than wrapped in an element.
         */
        root
            .contents()
            .each((_, node) => {
                if (
                    node.type === 'text' &&
                    /^and$/i.test(
                        cleanText(node.data || '')
                    )
                ) {
                    $(node).remove();
                }
            });
    }

}

function normalizeKeyPoints($, root) {
    /*
     * TechRadar begins this article with a three-item key-points list.
     * Tailwind's reset removes native list markers, so explicitly restore
     * them on this publisher's summary.
     */
    const lists = root
        .find('ul')
        .toArray();

    for (const node of lists) {
        const list = $(node);

        const items = list
            .children('li');

        if (
            items.length < 2 ||
            items.length > 5
        ) {
            continue;
        }

        const texts = items
            .toArray()
            .map(item =>
                cleanText(
                    $(item).text()
                )
            );

        const looksLikeKeyPoints =
            texts.every(
                text =>
                    text.length >= 35 &&
                    text.length <= 500
            ) &&
            items.filter(
                (_, item) =>
                    $(item).find('strong, b').length > 0
            ).length >= Math.min(2, items.length);

        if (!looksLikeKeyPoints) {
            continue;
        }

        list.addClass(
            'techradar-key-points'
        );

        /*
         * Inline style intentionally overrides Tailwind/preflight's
         * list-style:none without requiring a global index.html change.
         */
        list.attr(
            'style',
            [
                'list-style:disc',
                'list-style-position:outside',
                'padding-left:1.5em'
            ].join(';')
        );

        break;
    }
}


function removeNewsletter($, root) {
    root
        .find(
            'form, input, button, ' +
            '[class*="newsletter"], ' +
            '[id*="newsletter"], ' +
            '[data-component-name*="Newsletter"]'
        )
        .each((_, node) => {
            const box = $(node);

            const text = cleanText(
                box.text()
            );

            if (
                !text ||
                /newsletter|subscribe|email/i.test(text)
            ) {
                box.remove();
            }
        });


    root
        .find('div, section, aside, p, h2, h3')
        .each((_, node) => {
            const box = $(node);

            const text = cleanText(
                box.text()
            );

            if (
                text.length < 1800 &&
                (
                    /^Are you a pro\?\s*Subscribe to our newsletter/i.test(text) ||
                    /^Sign up to the TechRadar Pro newsletter/i.test(text) ||
                    /^By submitting your information you agree to/i.test(text)
                )
            ) {
                box.remove();
            }
        });
}


function cleanTechRadarMarkup(markup = '') {
    const value =
        String(markup || '');

    if (!value) {
        return value;
    }

    const $ = load(
        `<div id="techradar-clean-root">${value}</div>`,
        null,
        false
    );

    const root =
        $('#techradar-clean-root');


    root.find([
        '#utility-bar',
        '[data-analytics-id="utility-bar"]',
        '[data-jwp-carousel]',
        '[data-component-name^="JwPlayer"]',
        'script',
        'style',
        'noscript'
    ].join(',')).remove();


    normalizeKeyPoints(
        $,
        root
    );


    /*
     * For cached/native fragments remove publisher recommendation blocks.
     * Full-page extraction collects their cards BEFORE calling this.
     */
    collectAndRemoveRelatedSections(
        $,
        root
    );


    removeNewsletter(
        $,
        root
    );


    removeGoogleNewsPromotion(
        $,
        root
    );


    root
        .find('div, span, p')
        .each((_, node) => {
            const box =
                $(node);

            const text =
                cleanText(
                    box.text()
                );

            if (
                text.length <= 700 &&
                (
                    /^Follow us$/i.test(text) ||
                    /^Latest Videos From TechRadar$/i.test(text) ||
                    /^Watch full video here:/i.test(text) ||
                    /^Share this article$/i.test(text) ||
                    /^Join the conversation$/i.test(text) ||
                    /^Add us as a preferred source on Google$/i.test(text)
                )
            ) {
                box.remove();
            }
        });


    return root
        .html()
        .trim();
}

function extractTechRadarArticle(html = '') {
    const source =
        String(html || '');

    if (!source) {
        return null;
    }

    const $ =
        load(source);


    const articleBody =
        $('#article-body')
            .first();


    if (!articleBody.length) {
        return null;
    }


    /*
     * Search the entire publisher page, not just #article-body.
     *
     * Future/TechRadar can place "You may like" inside article-body but
     * "What to read next" in a sibling/recirculation structure.
     */
    const relatedArticles =
        collectAndRemoveRelatedSections(
            $,
            $.root()
        );


    /*
     * articleBody points to the same Cheerio document, so recommendation
     * containers removed above are also gone from articleBody.html().
     */
    const bodyMarkup =
        cleanTechRadarMarkup(
            articleBody.html() ||
            ''
        );


    if (
        cleanText(
            bodyMarkup
        ).length < 250
    ) {
        return null;
    }


    let heroMarkup = '';


    const hero =
        $('.hero-image-wrapper figure.article-media-figure')
            .first();


    if (hero.length) {
        const heroClone =
            hero.clone();


        heroClone
            .find(
                'script, style, noscript'
            )
            .remove();


        heroMarkup =
            heroClone
                .toString()
                .trim();
    }


    if (heroMarkup) {
        const heroSrc =
            hero
                .find('img')
                .first()
                .attr('src') ||
            '';


        if (
            heroSrc &&
            bodyMarkup.includes(
                heroSrc
            )
        ) {
            heroMarkup = '';
        }
    }


    const relatedMarkup =
        renderRelatedArticles(
            relatedArticles
        );


    /*
     * IMPORTANT:
     *
     * Related articles are intentionally LAST.
     *
     * This matches the app's BÀI VIẾT LIÊN QUAN treatment instead of
     * interrupting the publisher article wherever TechRadar inserted
     * its recirculation widget.
     */
    return [
        heroMarkup,
        bodyMarkup,
        relatedMarkup
    ]
        .filter(Boolean)
        .join('\n')
        .trim();
}

export default class TechRadarSource {
    match(hostname) {
        return (
            hostname === 'techradar.com' ||
            hostname.endsWith(
                '.techradar.com'
            )
        );
    }


    /*
     * Fix publisher metadata BEFORE the common article parser reads it.
     * This changes:
     *
     *   https://www.techradar.com/sg/author/christian-cawley
     *
     * into:
     *
     *   Christian Cawley
     */
    preProcessHtml(html) {
        return rewriteAuthorMetadata(
            html
        );
    }


    parseArticleHtmlContent(html) {
        return (
            extractTechRadarArticle(
                html
            ) ||
            false
        );
    }


    cleanCachedArticleContent(content) {
        const value =
            String(
                content ||
                ''
            );


        if (!value) {
            return value;
        }


        if (
            /<!doctype\s+html|<html\b/i.test(
                value
            ) &&
            /id=["']article-body["']/i.test(
                value
            )
        ) {
            return (
                extractTechRadarArticle(
                    value
                ) ||
                value
            );
        }


        return cleanTechRadarMarkup(
            value
        );
    }


    isUsableArticleResult(result) {
        const text =
            cleanText(
                result?.content ||
                ''
            );


        return (
            text.length >= 300
        );
    }
}

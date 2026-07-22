const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Revert modal panel wrapper
const modalWrapperRegex = /<div :class="theme === 'glass-light' \? 'apple-modal-panel[^>]*? flex flex-col'"\s*@click\.stop>/;
html = html.replace(
    modalWrapperRegex,
    `<div class="article-overlay-panel relative w-full md:w-[70%] lg:w-[65%] xl:w-[60%] max-w-6xl h-full bg-[#111827] border-l border-white/10 shadow-2xl flex flex-col"
             @click.stop>`
);

// 2. Revert Header background (bg-transparent -> bg-[#0B101E])
html = html.replace(
    '<div class="flex items-center justify-between px-5 py-4 flex-shrink-0 bg-transparent">',
    '<div class="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0 bg-[#0B101E]">'
);

// 3. Revert opaque reading surface (remove the extra div and classes)
// Find the div containing the content wrapper and remove it
const contentRegex = /<div x-show="!isLoadingOverlay && !overlayError && overlayContent" :class="[^"]*">\s*<template x-if="vozThreadNotice">/;
html = html.replace(
    contentRegex,
    `<div x-show="!isLoadingOverlay && !overlayError && overlayContent" class="px-6 md:px-10 py-8">
                    <template x-if="vozThreadNotice">`
);

// Also remove the closing div for the reading surface we added
html = html.replace(
    /<\/div> <!-- End of Apple Reader wrapper -->/,
    ''
);

// Revert article-content-area padding
html = html.replace(
    'class="p-6 md:p-8 flex-1 overflow-y-auto relative article-content-area"',
    'class="p-5 md:p-8 flex-1 overflow-y-auto relative article-content-area"'
);

// 4. Revert Hero image
const heroRegex = /<img :src="overlayArticle\.overlayImage" class="w-full h-auto max-h-\[40vh\] md:max-h-\[400px\] object-cover rounded-\[32px\] mb-10 shadow-\[0_8px_30px_rgb\(0,0,0,0\.08\)\]" @error="\$el\.style\.display='none'">/;
html = html.replace(
    heroRegex,
    `<img :src="overlayArticle.overlayImage" class="w-full h-auto max-h-[40vh] md:max-h-[320px] object-cover rounded-[16px] mb-8 shadow-lg" @error="$el.style.display='none'">`
);

// 5. Revert Title and Meta Row
const titleRegex = /<!-- Title -->[\s\S]*?<\/template>/;
html = html.replace(
    titleRegex,
    `<!-- Title -->
                    <h1 class="text-3xl md:text-4xl font-bold text-white leading-tight mb-6 mt-4 tracking-tight" x-text="overlayArticle ? (overlayArticle.overlayTitle || stripHtml(overlayArticle.title)) : ''"></h1>
                    
                    <!-- Meta row -->
                    <div class="flex flex-wrap items-center gap-3 text-sm text-gray-400 mb-8 pb-6 border-b border-white/10">
                        <template x-if="overlayArticle && (overlayArticle.siteName || overlayArticle.feedTitle)">
                            <span class="flex items-center gap-2">
                                <img :src="overlayArticle.feedIcon || smartSourceIcon({ domain: overlayArticle.link ? new URL(overlayArticle.link).hostname : '' })" class="w-4 h-4 rounded" @error="$el.style.display='none'">
                                <span class="text-emerald-400 font-semibold" x-text="overlayArticle.siteName || stripHtml(overlayArticle.feedTitle)"></span>
                            </span>
                        </template>`
);

// 6. Revert Audio Player
const audioRegex = /<div x-show="supportsArticleSpeech\(\) && overlayContent && !overlayHasNativeAudio && articleSpeechChunks\.length && !\(\(overlayArticle && overlayArticle\.link\) \|\| ''\)\.includes\('voz\.vn'\)" class="mb-10 rounded-full border border-black\/5 dark:border-white\/10 bg-black\/5 dark:bg-white\/10 backdrop-blur-xl p-3 px-4 shadow-sm w-full max-w-\[420px\] mx-auto">/;
html = html.replace(
    audioRegex,
    `<div x-show="supportsArticleSpeech() && overlayContent && !overlayHasNativeAudio && articleSpeechChunks.length && !((overlayArticle && overlayArticle.link) || '').includes('voz.vn')" class="mb-7 rounded-[16px] border border-emerald-500/20 bg-emerald-500/[0.07] p-3.5 md:p-4">`
);

// 7. Revert Related Coverage
const relatedRegex = /<section class="mt-16 pt-8">[\s\S]*?<\/section>/;
html = html.replace(
    relatedRegex,
    `<section class="mt-12 pt-7 border-t border-white/10">
                            <div class="flex items-center justify-between gap-4 mb-4">
                                <h2 class="text-lg font-bold text-white">Related coverage</h2>
                                <span class="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-3 py-1" x-text="overlayArticle.sourceCount + (overlayArticle.sourceCount === 1 ? ' source' : ' sources')"></span>
                            </div>
                            <div class="space-y-2">
                            <template x-for="(related, relatedIndex) in sortedRelatedArticles(overlayArticle.relatedArticles)" :key="articleKey(related, relatedIndex)">
                                    <a :href="related.link" target="_blank" rel="noopener noreferrer" class="flex items-start gap-3 p-3 rounded-[12px] bg-white/[0.03] border border-white/5 hover:border-emerald-500/30 hover:bg-white/[0.05] transition group/source">
                                        <img :src="related.feedIcon || smartSourceIcon({ domain: related.link ? new URL(related.link).hostname : '' })" class="w-5 h-5 rounded mt-0.5 flex-shrink-0" @error="$el.style.display='none'">
                                        <span class="min-w-0 flex-1">
                                            <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] mb-1">
                                                <span class="font-semibold text-emerald-400" x-text="related.feedTitle"></span>
                                                <span class="text-gray-600">•</span>
                                                <span class="text-gray-500" x-text="related.publicationTimeReliable === false ? 'Time unavailable' : formatVietnamDateTime(related.pubDate)"></span>
                                            </span>
                                            <span class="block text-sm text-gray-200 leading-snug group-hover/source:text-white transition" x-text="stripHtml(related.title)"></span>
                                        </span>
                                        <svg class="w-4 h-4 text-gray-600 group-hover/source:text-emerald-400 flex-shrink-0 mt-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                    </a>
                                </template>
                            </div>
                        </section>`
);

fs.writeFileSync('index.html', html);
console.log('Reverted HTML structure to classic.');

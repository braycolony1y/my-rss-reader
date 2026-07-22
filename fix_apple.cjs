const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Revert CSS block to restore .theme-glass and fix .theme-glass-light
const cssRegex = /\.theme-glass, \.theme-glass-light \{[\s\S]*?\/\* Override text colors globally for light mode \*\//;
const newCss = `.theme-glass {
            background: linear-gradient(135deg, #1b2838 0%, #0d1217 50%, #17242d 100%) !important;
            background-attachment: fixed !important;
        }
        /* Target all dark background variations for dark glass mode */
        .theme-glass [class*="bg-[#111827]"],
        .theme-glass [class*="bg-[#0B101E]"],
        .theme-glass [class*="bg-[#121212]"],
        .theme-glass [class*="bg-[#1e1e1e]"],
        .theme-glass [class*="bg-gray-800"] {
            background: rgba(17, 24, 39, 0.4) !important;
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.05) !important;
        }
        /* Make the main container completely transparent so the body gradient shows through */
        .theme-glass [class*="bg-[#0A0F1A]"] {
            background: transparent !important;
            backdrop-filter: none !important;
            border: none !important;
            box-shadow: none !important;
        }
        .theme-glass .text-\\[\\#d4d4d4\\] {
            color: #f3f4f6 !important;
        }

        .theme-glass-light {
            /* Common Liquid Glass variables */
            --apple-blur: blur(24px);
            --apple-saturate: saturate(190%);
            background: radial-gradient(circle at 10% 20%, #fdfbfb 0%, #ebedee 100%) !important;
            background-attachment: fixed !important;
            color: #1d1d1f !important;
        }

        /* Unified Liquid Glass Overrides (Light Only) */
        .theme-glass-light [class*="bg-[#111827]"], .theme-glass-light [class*="bg-[#0B101E]"], .theme-glass-light [class*="bg-[#121212]"], .theme-glass-light [class*="bg-[#1e1e1e]"], .theme-glass-light [class*="bg-[#080F19]"], .theme-glass-light [class*="bg-gray-800"] {
            background: rgba(255, 255, 255, 0.65) !important;
            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            border: 1px solid rgba(255, 255, 255, 0.8) !important;
            border-bottom: 1px solid rgba(0, 0, 0, 0.05) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.8) !important;
        }
        
        .theme-glass-light [class*="bg-[#0A0F1A]"] {
            background: transparent !important;
            backdrop-filter: none !important;
            border: none !important;
            box-shadow: none !important;
        }

        .theme-glass-light .article-overlay-backdrop {
            background: rgba(255, 255, 255, 0.3) !important;
            backdrop-filter: blur(10px) !important;
        }

        .theme-glass-light .apple-modal-panel {
            background: rgba(240, 240, 240, 0.6) !important;
            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            border: 1px solid rgba(255, 255, 255, 0.9) !important;
            box-shadow: 0 24px 48px rgba(0,0,0,0.1) !important;
        }

        /* Fix thumbnail gradient for light mode */
        .theme-glass-light [class*="from-[#111827]"] {
            --tw-gradient-from: rgba(255, 255, 255, 0.8) var(--tw-gradient-from-position) !important;
            --tw-gradient-to: rgba(255, 255, 255, 0) var(--tw-gradient-to-position) !important;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
        }
        .theme-glass-light [class*="via-[#111827]"], .theme-glass-light [class*="via-[#0D1721]"] {
            --tw-gradient-via: rgba(255, 255, 255, 0.4) var(--tw-gradient-via-position) !important;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to) !important;
        }
        .theme-glass-light [class*="to-[#0B121D]"] {
            --tw-gradient-to: rgba(255, 255, 255, 0) var(--tw-gradient-to-position) !important;
        }

        /* Clean up separators and heavy UI */
        .theme-glass-light .border-white\\/10 {
            border-color: rgba(128, 128, 128, 0.1) !important;
        }

        /* Typography overrides for reading */
        .theme-glass-light .text-white, .theme-glass-light .text-gray-200 { color: #1d1d1f !important; }
        .theme-glass-light .text-gray-300 { color: #424245 !important; }
        .theme-glass-light .text-gray-400 { color: #86868b !important; }
        
        /* Neon color removal for Light Mode ONLY */
        .theme-glass-light .text-emerald-400, .theme-glass-light .text-teal-400 { color: #34C759 !important; }
        .theme-glass-light .text-orange-400, .theme-glass-light .text-amber-300 { color: #FF9500 !important; }
        .theme-glass-light .text-blue-400, .theme-glass-light .text-cyan-400 { color: #007AFF !important; }
        .theme-glass-light a.bg-emerald-600, .theme-glass-light button.bg-emerald-600 {
            background-color: #34C759 !important;
            color: #ffffff !important;
            border: none !important;
        }

        .theme-glass-light input[type="text"] { border-radius: 20px !important; }
        .theme-glass-light button, .theme-glass-light a { color: inherit; }

        /* Override text colors globally for light mode */`;

html = html.replace(cssRegex, newCss);

// 2. Restore dynamic modal container
html = html.replace(
    '<div class="apple-modal-panel relative w-full max-w-[760px] h-[100dvh] md:h-[90dvh] md:rounded-[24px] bg-[#111827] shadow-2xl flex flex-col overflow-hidden"',
    '<div :class="theme === \'glass-light\' ? \'apple-modal-panel relative w-full max-w-[760px] h-[100dvh] md:h-[90dvh] md:rounded-[24px] shadow-2xl flex flex-col overflow-hidden\' : \'article-overlay-panel relative w-full md:w-[70%] lg:w-[65%] xl:w-[60%] max-w-6xl h-full bg-[#111827] border-l border-white/10 shadow-2xl flex flex-col\'"'
);

// 3. Wrap article content in opaque reading surface in light mode
// Find the article-content-area div
html = html.replace(
    'class="p-6 md:p-12 flex-1 overflow-y-auto relative article-content-area"',
    'class="p-6 md:p-8 flex-1 overflow-y-auto relative article-content-area"'
);

// We need to inject the wrapper just inside article-content-area
const contentAreaStart = html.indexOf('<div class="p-6 md:p-8 flex-1 overflow-y-auto relative article-content-area"');
if (contentAreaStart !== -1) {
    const afterContentArea = html.indexOf('>', contentAreaStart) + 1;
    html = html.substring(0, afterContentArea) + 
        '\\n                    <div :class="theme === \'glass-light\' ? \'bg-white rounded-[32px] p-6 md:p-12 shadow-sm border border-gray-100 mb-8 max-w-[720px] mx-auto\' : \'max-w-[760px] mx-auto\'">' + 
        html.substring(afterContentArea);
    
    // Find the end of the scrollable area (before closing tag of article-content-area)
    // Actually, just find the end of the content area. We can use </template> for voz thread bottom as a marker, or the end of the article overlay.
    const vozThreadBottom = html.indexOf('<!-- VOZ Thread Bottom Pagination Bar -->');
    if (vozThreadBottom !== -1) {
        // Find the next </div> after the pagination bar
        const paginationEnd = html.indexOf('</div>', vozThreadBottom) + 6;
        html = html.substring(0, paginationEnd) + 
            '\\n                    </div> <!-- End of Apple Reader wrapper -->' + 
            html.substring(paginationEnd);
    }
}

// 4. Update Hero Image radius for Apple Reader
html = html.replace(
    'md:max-h-[400px] object-cover rounded-[24px] mb-10 shadow-[0_8px_30px_rgb(0,0,0,0.12)]"',
    'md:max-h-[400px] object-cover rounded-[32px] mb-10 shadow-[0_8px_30px_rgb(0,0,0,0.08)]"'
);

// 5. Replace Related Coverage with Carousel
const relatedRegex = /<section class="mt-16 pt-8">[\s\S]*?<\/section>/;
const newRelated = `<section class="mt-16 pt-8">
                            <div class="flex items-center justify-between gap-4 mb-6 px-2">
                                <h2 class="text-2xl font-bold tracking-tight" :class="theme === 'glass-light' ? 'text-gray-900' : 'text-white'">Related coverage</h2>
                                <span class="text-xs rounded-full px-3 py-1 font-medium" :class="theme === 'glass-light' ? 'bg-gray-100 text-gray-500' : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'" x-text="overlayArticle.sourceCount + (overlayArticle.sourceCount === 1 ? ' source' : ' sources')"></span>
                            </div>
                            <div class="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-6 pt-2 hide-scrollbar -mx-4 px-4 md:mx-0 md:px-2">
                            <template x-for="(related, relatedIndex) in sortedRelatedArticles(overlayArticle.relatedArticles)" :key="articleKey(related, relatedIndex)">
                                    <a :href="related.link" target="_blank" rel="noopener noreferrer" 
                                       class="snap-start flex-shrink-0 w-[280px] flex flex-col p-4 rounded-[24px] transition-all transform hover:-translate-y-1"
                                       :class="theme === 'glass-light' ? 'bg-white shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-gray-100 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]' : 'bg-[#1e293b] border border-white/10 hover:border-emerald-500/30'">
                                        <div class="mb-4">
                                            <template x-if="related.image">
                                                <img :src="related.image" class="w-full h-32 object-cover rounded-[16px] shadow-sm">
                                            </template>
                                            <template x-if="!related.image">
                                                <div class="w-full h-32 flex items-center justify-center rounded-[16px] shadow-sm" :class="theme === 'glass-light' ? 'bg-gray-50' : 'bg-[#0B101E]'">
                                                    <img :src="related.feedIcon || smartSourceIcon({ domain: related.link ? new URL(related.link).hostname : '' })" class="w-12 h-12 rounded-lg opacity-80" @error="$el.style.display='none'">
                                                </div>
                                            </template>
                                        </div>
                                        <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs mb-2">
                                            <img :src="related.feedIcon || smartSourceIcon({ domain: related.link ? new URL(related.link).hostname : '' })" class="w-4 h-4 rounded" @error="$el.style.display='none'">
                                            <span class="font-semibold" :class="theme === 'glass-light' ? 'text-gray-700' : 'text-emerald-400'" x-text="related.feedTitle"></span>
                                        </span>
                                        <span class="block text-sm font-semibold leading-snug line-clamp-3" :class="theme === 'glass-light' ? 'text-gray-900' : 'text-white'" x-text="stripHtml(related.title)"></span>
                                        <div class="mt-auto pt-3">
                                            <span class="text-[11px] font-medium text-gray-400" x-text="related.publicationTimeReliable === false ? 'Time unavailable' : formatVietnamDateTime(related.pubDate)"></span>
                                        </div>
                                    </a>
                                </template>
                            </div>
                        </section>`;
                        
html = html.replace(relatedRegex, newRelated);

// Also inject hide-scrollbar CSS in the head
const styleStart = html.indexOf('<style>');
if (styleStart !== -1) {
    html = html.substring(0, styleStart + 7) + 
        '\\n        .hide-scrollbar::-webkit-scrollbar { display: none; }\\n        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }' + 
        html.substring(styleStart + 7);
}

fs.writeFileSync('index.html', html);
console.log('Script executed');

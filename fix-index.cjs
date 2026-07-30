const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Vibrant mesh backgrounds for theme-glass
html = html.replace(
    'background: linear-gradient(135deg, #1f1f1f 0%, #0a0a0a 50%, #141414 100%) !important;',
    `background: radial-gradient(circle at 15% 50%, rgba(76, 29, 149, 0.25), transparent 50%), radial-gradient(circle at 85% 30%, rgba(14, 116, 144, 0.25), transparent 50%), radial-gradient(circle at 50% 80%, rgba(15, 118, 110, 0.25), transparent 50%), linear-gradient(135deg, #09090b 0%, #18181b 100%) !important;`
);

// 2. Add input focus for theme-glass
if (!html.includes('/* Adjust input fields for dark glass */')) {
    html = html.replace(
        '.theme-glass .text-\\[\\#d4d4d4\\] {',
        `/* Adjust input fields for dark glass */
        .theme-glass input { background: rgba(0, 0, 0, 0.2) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; backdrop-filter: blur(12px) !important; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1) !important; }
        .theme-glass input:focus { background: rgba(0, 0, 0, 0.3) !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2), inset 0 2px 4px rgba(0, 0, 0, 0.2) !important; }
        .theme-glass .text-\\[\\#d4d4d4\\] {`
    );
}

// 3. Unisex mesh backgrounds for theme-glass-light
html = html.replace(
    'background: radial-gradient(circle at 10% 20%, #fdfbfb 0%, #ebedee 100%) !important;',
    `background: radial-gradient(circle at 10% 20%, rgba(94, 234, 212, 0.4), transparent 50%), radial-gradient(circle at 90% 80%, rgba(125, 211, 252, 0.4), transparent 50%), radial-gradient(circle at 50% 50%, rgba(148, 163, 184, 0.3), transparent 50%), linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%) !important;`
);

// 4. Update bg overrides in theme-glass-light
html = html.replace(
    'background: rgba(255, 255, 255, 0.65) !important;',
    'background: rgba(255, 255, 255, 0.5) !important;'
);

html = html.replace(
    'background-color: rgba(255, 255, 255, 0.5) !important;',
    'background: rgba(255, 255, 255, 0.8) !important;'
);
html = html.replace(
    'border-color: rgba(255, 255, 255, 0.7) !important;',
    'border: 1px solid rgba(0, 0, 0, 0.08) !important;'
);

// 5. Remove backdrop-filter from embedded-suggested-card to prevent flash
html = html.replace(
    `            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;\n            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;\n            border: 1px solid rgba(255, 255, 255, 0.8) !important;`,
    `            border: 1px solid rgba(0, 0, 0, 0.05) !important;`
);

// 6. Fix thumbnail-img mask
html = html.replace(
    '.article-card img {',
    '.article-card img.thumbnail-img {'
);
html = html.replace(
    'class="w-full h-full object-cover"',
    'class="thumbnail-img w-full h-full object-cover"'
);

// 7. Fix syncProgress colors
html = html.replace(
    `'bg-red-500/20 text-red-600 dark:text-red-300' : syncProgress.done ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300' : 'bg-blue-500/20 text-blue-600 dark:text-blue-300'`,
    `'bg-red-500/30 text-red-700 dark:text-red-300' : syncProgress.done ? 'bg-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'bg-blue-500/30 text-blue-700 dark:text-blue-300'`
);
html = html.replace(
    `class="w-4 h-4 animate-spin"`,
    `class="w-5 h-5 animate-spin"`
);
html = html.replace(
    `class="w-4 h-4" fill="none"`,
    `class="w-5 h-5" fill="none"`
);
html = html.replace(
    `class="w-4 h-4" fill="none"`,
    `class="w-5 h-5" fill="none"`
);
html = html.replace(
    `text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200`,
    `text-xs font-extrabold uppercase tracking-wider text-gray-900 dark:text-white`
);
html = html.replace(
    `text-[10px] tabular-nums text-gray-500 dark:text-gray-400`,
    `text-[11px] font-bold tabular-nums text-gray-900 dark:text-gray-100`
);
html = html.replace(
    `text-sm text-gray-700 dark:text-gray-300 mt-1 leading-snug`,
    `text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 leading-snug`
);
html = html.replace(
    `h-1 rounded-full bg-black/10 dark:bg-white/10`,
    `h-1.5 rounded-full bg-black/20 dark:bg-white/20`
);

// 8. Move clear cache button
const clearCacheBtn = `
                    <!-- Clear Cache Button (At the bottom of the article) -->
                    <template x-if="overlayArticle && overlayFetchedFromCache">
                        <div class="mt-8 flex justify-end">
                            <button @click="clearArticleCache" 
                                    class="px-4 py-2 bg-white/[0.05] hover:bg-red-500/20 text-gray-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 rounded-xl transition-all active:scale-95 flex items-center gap-2 text-sm font-medium"
                                    title="Tải lại bản mới nhất">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                <span>Xoá bộ nhớ đệm (Làm mới)</span>
                            </button>
                        </div>
                    </template>
`;
html = html.replace(clearCacheBtn, '');

const targetLocation = `                            <button @click="rejectAndTryNextArticleMethod()" :disabled="overlayTryingMethod" class="px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-gray-400 hover:text-amber-200 hover:border-amber-500/30 transition disabled:opacity-40">
                                <span x-text="overlayTryingMethod ? 'Trying next method…' : 'Reject current · try next'"></span>
                            </button>
                        </div>`;

html = html.replace(targetLocation, `                            <div class="flex items-center gap-2">
                                <button x-show="overlayFetchedFromCache" @click="clearArticleCache" class="px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-gray-400 hover:text-red-400 hover:border-red-500/30 transition disabled:opacity-40" title="Tải lại bản mới nhất">
                                    <span>Xoá bộ nhớ đệm (Làm mới)</span>
                                </button>
                                <button @click="rejectAndTryNextArticleMethod()" :disabled="overlayTryingMethod" class="px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-gray-400 hover:text-amber-200 hover:border-amber-500/30 transition disabled:opacity-40">
                                    <span x-text="overlayTryingMethod ? 'Trying next method…' : 'Reject current · try next'"></span>
                                </button>
                            </div>
                        </div>`);

fs.writeFileSync('index.html', html);
console.log('Fixed index.html');

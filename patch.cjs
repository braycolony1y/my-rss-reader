const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Add theme-glass CSS
const css = `
        .theme-glass {
            background: linear-gradient(135deg, #1b2838 0%, #0d1217 50%, #17242d 100%) !important;
            background-attachment: fixed !important;
        }
        .theme-glass .bg-\\[\\#111827\\], .theme-glass .bg-\\[\\#0B101E\\]\\/65, .theme-glass .bg-gray-800, .theme-glass .bg-\\[\\#1e1e1e\\], .theme-glass .bg-\\[\\#121212\\] {
            background: rgba(17, 24, 39, 0.45) !important;
            backdrop-filter: blur(28px) saturate(180%);
            -webkit-backdrop-filter: blur(28px) saturate(180%);
            border-color: rgba(255, 255, 255, 0.1) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3) !important;
        }
        .theme-glass .bg-\\[\\#0B101E\\] {
            background: transparent !important;
        }
        .theme-glass .text-\\[\\#d4d4d4\\] {
            color: #f3f4f6 !important;
        }
`;
html = html.replace('</style>', css + '</style>');

// 2. Add dynamic body class
html = html.replace(
    '<body class="bg-[#1e1e1e] text-[#d4d4d4] font-sans antialiased h-[100dvh] overflow-hidden flex selection:bg-blue-500/30" x-data="rssApp()"',
    '<body class="font-sans antialiased h-[100dvh] overflow-hidden flex selection:bg-blue-500/30" :class="theme === \'glass\' ? \'theme-glass text-gray-200\' : \'bg-[#1e1e1e] text-[#d4d4d4]\'" x-data="rssApp()"'
);

// 3. Remove "Your latest insights, all in one place"
html = html.replace('<p class="text-sm text-gray-400 mt-1">Your latest insights, all in one place</p>', '');

// 4. Update action bar to be compact on mobile
const oldActionBar = `<div class="flex items-center gap-3 w-full md:w-auto text-gray-400 flex-shrink-0">
                    <div class="relative flex items-center flex-1 md:flex-initial w-full md:w-64 lg:w-80 transition-all group">`;
const newActionBar = `<div class="flex items-center gap-1.5 md:gap-3 w-full md:w-auto text-gray-400 flex-shrink-0">
                    <div class="relative flex items-center flex-1 md:flex-initial w-full md:w-48 lg:w-80 transition-all group">`;
html = html.replace(oldActionBar, newActionBar);

// Update padding on buttons inside action bar to be p-1.5 md:p-2
html = html.replace(/class="hover:text-white transition p-2 rounded-full border border-white\/10 bg-\[\#111827\]"/g, 'class="hover:text-white transition p-1.5 md:p-2 rounded-full border border-white/10 bg-[#111827]"');

// 5. Add toggle theme button next to the Sync button
const syncButton = `<button @click="syncNow()" class="hover:text-white transition p-1.5 md:p-2 rounded-full border border-white/10 bg-[#111827]" :class="isSyncing ? 'animate-spin text-emerald-400 border-emerald-500/30' : ''" title="Refresh">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    </button>`;
const themeButton = `
                    <button @click="theme = theme === 'glass' ? 'classic' : 'glass'; localStorage.setItem('theme', theme)" class="hover:text-white transition p-1.5 md:p-2 rounded-full border border-white/10 bg-[#111827]" title="Toggle Theme">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path x-show="theme !== 'glass'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                            <path x-show="theme === 'glass'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" style="display: none;" />
                        </svg>
                    </button>`;
html = html.replace(syncButton, themeButton + '\n                    ' + syncButton);

fs.writeFileSync('index.html', html);
console.log("Patched index.html");

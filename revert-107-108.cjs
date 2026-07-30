const fs = require('fs');
let html = fs.readFileSync('/home/ubuntu/my-rss-reader/index.html', 'utf8');

// Revert 107 (Panel background)
html = html.replace(
    /class="article-overlay-panel relative w-full h-\[100dvh\] md:w-\[90%\] md:max-w-\[720px\] md:h-\[85vh\] md:max-h-\[85vh\] md:rounded-3xl shadow-2xl flex flex-col overflow-hidden" \n\s*:class="theme === 'glass-light' \? 'bg-white\/80 backdrop-blur-3xl border border-white\/40 shadow-emerald-900\/10' : \(theme === 'glass-dark' \? 'bg-\[#0f172a\]\/80 backdrop-blur-3xl border border-white\/10' : 'bg-\[#111827\]'\)"/g,
    'class="article-overlay-panel relative w-full h-[100dvh] md:w-[90%] md:max-w-[720px] md:h-[85vh] md:max-h-[85vh] md:rounded-3xl bg-[#111827] shadow-2xl flex flex-col overflow-hidden"'
);

// Revert 107 (Header)
html = html.replace(
    /<div class="flex items-center justify-between px-5 py-4 flex-shrink-0" :class="theme === 'glass-light' \? 'border-b border-gray-200\/50 bg-white\/40' : \(theme === 'glass-dark' \? 'border-b border-white\/10 bg-\[#0B101E\]\/40' : 'border-b border-white\/10 bg-\[#0B101E\]'\)">/g,
    '<div class="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0 bg-[#0B101E]">'
);

// Revert 108 (Backdrop)
html = html.replace(
    /class="absolute inset-0" :class="theme === 'glass-light' \? 'bg-gray-400\/20 backdrop-blur-md' : \(theme === 'glass-dark' \? 'bg-black\/40 backdrop-blur-md' : 'bg-black\/60'\)"/g,
    'class="absolute inset-0 bg-black/60" :class="theme.includes(\'glass\') ? \'backdrop-blur-md\' : \'\'"'
);

fs.writeFileSync('/home/ubuntu/my-rss-reader/index.html', html);
console.log("Reverted 107 and 108!");

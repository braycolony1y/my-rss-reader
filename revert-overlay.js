const fs = require('fs');
let html = fs.readFileSync('/home/ubuntu/my-rss-reader/index.html', 'utf8');

// Revert panel
html = html.replace(
    /class="article-overlay-panel relative[^>]*? flex flex-col overflow-hidden" \n\s*:class="[^"]*"/s,
    'class="article-overlay-panel relative w-full h-[100dvh] md:w-[90%] md:max-w-[720px] md:h-[85vh] md:max-h-[85vh] md:rounded-3xl bg-[#111827] shadow-2xl flex flex-col overflow-hidden"'
);

// Revert header
html = html.replace(
    /<div class="flex items-center justify-between px-5 py-4 flex-shrink-0" :class="[^"]*">/,
    '<div class="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0 bg-[#0B101E]">'
);

fs.writeFileSync('/home/ubuntu/my-rss-reader/index.html', html);
console.log("Reverted");

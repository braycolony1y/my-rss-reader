const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Fix main background
html = html.replace(
    '<main x-show="isLoggedIn" x-cloak class="flex-1 flex flex-col h-full bg-[#121212] overflow-hidden relative">',
    '<main x-show="isLoggedIn" x-cloak class="flex-1 flex flex-col h-full bg-[#0A0F1A] overflow-hidden relative">'
);

// 2. Fix sidebar background
html = html.replace(
    'class="fixed md:relative inset-y-0 left-0 z-50 bg-[#181818] flex-shrink-0 flex-col h-[100dvh] transition-all duration-300 ease-in-out whitespace-nowrap overflow-x-hidden border-r border-white/5"',
    'class="fixed md:relative inset-y-0 left-0 z-50 bg-[#111827] flex-shrink-0 flex-col h-[100dvh] transition-all duration-300 ease-in-out whitespace-nowrap overflow-x-hidden border-r border-white/5"'
);

// 3. Fix ME avatar and News text
html = html.replace(
    '<div class="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-white font-bold text-lg shadow-[0_0_15px_rgba(16,185,129,0.3)]">ME</div>',
    '<div class="w-12 h-12 rounded-full bg-[#20C997] flex items-center justify-center text-white font-bold text-xl">ME</div>'
);
html = html.replace(
    '<span class="font-bold text-white tracking-wide text-lg">News</span>',
    '<span class="font-bold text-white tracking-wide text-2xl">News</span>'
);

// 4. Fix Add Feed Card
html = html.replace(
    '<div class="relative z-10 bg-[#151C2C]/80 backdrop-blur-md rounded-2xl p-5 border border-white/5 shadow-2xl flex flex-col gap-3">',
    '<div class="relative z-10 bg-[#1A2230] rounded-2xl p-5 border border-transparent flex flex-col gap-3">'
);
html = html.replace(
    '<div class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-500 mb-1 shadow-[0_0_15px_rgba(249,115,22,0.2)]">',
    '<div class="w-12 h-12 rounded-[14px] bg-[#2A1D1A] flex items-center justify-center text-[#F37B3D] mb-1">'
);
html = html.replace(
    '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 11a9 9 0 019 9h-2a7 7 0 00-7-7v-2zm0-4a13 13 0 0113 13h-2a11 11 0 00-11-11V7zm1.5 13a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"></path></svg>',
    '<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M4 11a9 9 0 019 9h-2a7 7 0 00-7-7v-2zm0-4a13 13 0 0113 13h-2a11 11 0 00-11-11V7zm1.5 13a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"></path></svg>'
);
html = html.replace(
    '<h3 class="font-bold text-white text-sm">Add your favorite feeds</h3>',
    '<h3 class="font-bold text-white text-[16px] leading-tight">Add your favorite feeds</h3>'
);
html = html.replace(
    '<p class="text-xs text-gray-400 mb-1 leading-relaxed">Stay updated with the content you love.</p>',
    '<p class="text-[14px] text-gray-400 mb-2 leading-snug">Stay updated with the content you love.</p>'
);
html = html.replace(
    '<button @click="showAddFeedModal = true" class="w-full bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-500 hover:to-teal-600 text-[#0B101E] py-2 rounded-lg text-sm font-bold shadow-[0_4px_15px_rgba(16,185,129,0.3)] transition flex items-center justify-center gap-2">',
    '<button @click="showAddFeedModal = true" class="w-full bg-[#20C997] hover:bg-[#1BAE83] text-[#0A0F1A] py-2.5 rounded-xl text-[15px] font-bold transition flex items-center justify-center gap-2">'
);
html = html.replace(
    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>',
    '<span>+</span>'
);

fs.writeFileSync('index.html', html);
console.log("Replacements done!");

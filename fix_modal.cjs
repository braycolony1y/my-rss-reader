const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

content = content.replace(
    /<div x-show="debugModalOpen" x-cloak class="fixed inset-0 bg-\[#0B101E\]\/80 z-\[70\] flex items-center justify-center p-2 md:p-4">/,
    `<div x-show="debugModalOpen" x-cloak class="fixed inset-0 z-[70] flex items-center justify-center p-2 md:p-4 transition" :class="theme.includes('glass') ? 'backdrop-blur-md bg-black/40' : 'bg-[#0B101E]/80'">`
);
content = content.replace(
    /<div class="bg-\[#0B101E\] rounded-xl w-full max-w-4xl max-h-\[90vh\] flex flex-col border border-\[#333\] shadow-2xl"/,
    `<div class="rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col border shadow-2xl transition overflow-hidden" :class="theme === 'glass-light' ? 'bg-white/70 border-white/50 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-2xl' : (theme === 'glass' ? 'bg-black/60 border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.2)] backdrop-blur-2xl' : 'bg-[#0B101E] border-[#333]')"`
);
content = content.replace(
    /<div class="flex items-center justify-between px-5 py-4 border-b border-\[#333\] flex-shrink-0">/,
    `<div class="flex items-center justify-between px-5 py-4 border-b flex-shrink-0 transition" :class="theme === 'glass-light' ? 'border-gray-200' : 'border-[#333]'">`
);
content = content.replace(
    /<h2 class="text-lg font-bold text-white flex items-center gap-2">/,
    `<h2 class="text-lg font-bold flex items-center gap-2 transition" :class="theme === 'glass-light' ? 'text-gray-900' : 'text-white'">`
);
content = content.replace(
    /<button @click="debugModalOpen = false" class="text-gray-400 hover:text-white transition">/,
    `<button @click="debugModalOpen = false" class="transition" :class="theme === 'glass-light' ? 'text-gray-500 hover:text-gray-900' : 'text-gray-400 hover:text-white'">`
);
content = content.replace(
    /<div class="flex flex-col items-center justify-center h-40 text-gray-400 gap-3">/,
    `<div class="flex flex-col items-center justify-center h-40 gap-3 transition" :class="theme === 'glass-light' ? 'text-gray-600' : 'text-gray-400'">`
);
// inner cards
content = content.replace(
    /class="bg-\[#222\] p-4 rounded-lg border border-\[#333\]"/g,
    `class="p-4 rounded-lg border transition" :class="theme === 'glass-light' ? 'bg-white/50 border-gray-200' : (theme === 'glass' ? 'bg-white/5 border-white/10' : 'bg-[#222] border-[#333]')"`
);
// headings inside cards
content = content.replace(
    /class="font-bold text-gray-300 mb-3 border-b border-\[#333\] pb-2"/g,
    `class="font-bold mb-3 border-b pb-2 transition" :class="theme === 'glass-light' ? 'text-gray-800 border-gray-200' : 'text-gray-300 border-[#333]'"`
);
// json ld blocks
content = content.replace(
    /class="bg-\[#0B101E\] p-2 rounded text-xs border border-\[#333\]"/g,
    `class="p-2 rounded text-xs border transition" :class="theme === 'glass-light' ? 'bg-black/5 border-gray-200' : 'bg-[#0B101E] border-[#333]'"`
);
// target URL error block
content = content.replace(
    /class="flex items-center gap-2 text-xs bg-\[#0B101E\] px-3 py-1\.5 rounded border border-\[#333\]"/g,
    `class="flex items-center gap-2 text-xs px-3 py-1.5 rounded border transition" :class="theme === 'glass-light' ? 'bg-black/5 border-gray-200' : 'bg-[#0B101E] border-[#333]'"`
);

fs.writeFileSync('index.html', content);

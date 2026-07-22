const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Fix sidebar text overflow
html = html.replace(
    '<h3 class="font-bold text-white text-[15px] leading-tight">Add your favorite feeds</h3>',
    '<h3 class="font-bold text-white text-[15px] leading-tight whitespace-normal">Add your favorite feeds</h3>'
);
html = html.replace(
    '<p class="text-[13px] text-gray-400 mb-2 leading-snug">Stay updated with the content you love.</p>',
    '<p class="text-[13px] text-gray-400 mb-2 leading-snug whitespace-normal">Stay updated with the content you love.</p>'
);

// 2. Fix Article Background Image
// Replace the old background image block
let oldBg = `<div class="absolute inset-y-0 right-0 w-full md:w-3/4 z-0" x-show="article.image">
                            <img :src="article.image" loading="lazy" class="w-full h-full object-cover opacity-50 mix-blend-lighten" style="-webkit-mask-image: linear-gradient(to right, transparent, black 40%); mask-image: linear-gradient(to right, transparent, black 40%);">
                            <div class="absolute inset-0 bg-gradient-to-r from-[#111827] via-[#111827]/80 to-transparent"></div>
                        </div>`;

let newBg = `<div class="absolute inset-y-0 right-0 w-full md:w-[50%] z-0" x-show="article.image">
                            <img :src="article.image" loading="lazy" class="w-full h-full object-cover opacity-90" style="-webkit-mask-image: linear-gradient(to right, transparent, black 30%); mask-image: linear-gradient(to right, transparent, black 30%);">
                            <div class="absolute inset-0 bg-gradient-to-r from-[#111827] via-transparent to-transparent"></div>
                        </div>`;

html = html.replace(oldBg, newBg);

fs.writeFileSync('index.html', html);
console.log("Replacements done!");

const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// The block to replace
const oldBlock = `<div class="mb-5 relative overflow-hidden bg-[#111827] rounded-2xl cursor-pointer group border border-white/5 hover:border-white/20 transition-all shadow-lg" :class="[
                            (isMobile && mobileActiveCard === article.link) ? 'ring-2 ring-emerald-500' : '',
                            readStates.includes(article.link) ? 'opacity-60 grayscale-[50%]' : ''
                        ]" @click="handleCardClick(article, $event)">
                        
                        <!-- Background Image with Gradient Overlay -->
                        <div class="absolute inset-y-0 right-0 w-full md:w-[50%] z-0" x-show="article.image">
                            <img :src="article.image" loading="lazy" class="w-full h-full object-cover opacity-100" style="-webkit-mask-image: linear-gradient(to right, transparent, black 30%); mask-image: linear-gradient(to right, transparent, black 30%);">
                            <div class="absolute inset-0 bg-gradient-to-r from-[#111827] via-transparent to-transparent"></div>
                        </div>

                        <!-- Content over background -->
                        <div class="relative z-10 flex flex-col p-6 md:p-8 w-full md:w-[65%] min-h-[220px] justify-center">
                            <div class="flex items-center gap-2 text-[11px] font-bold tracking-wider mb-4 uppercase">
                                <span class="flex items-center gap-2 bg-[#0B101E]/60 backdrop-blur px-2.5 py-1 rounded-md text-emerald-400 border border-emerald-500/10">
                                    <img :src="article.feedIcon || \`https://icons.duckduckgo.com/ip3/\${new URL(article.link).hostname}.ico\`" class="w-4 h-4 rounded" @error="$el.style.display='none'">
                                    <span x-text="stripHtml(article.feedTitle)"></span>
                                </span>
                                <span class="text-white/20">•</span>
                                <span class="text-gray-400" x-text="timeAgo(article.pubDate)"></span>
                            </div>
                            
                            <h2 class="text-xl md:text-[26px] font-extrabold text-white leading-tight mb-3 drop-shadow-md pr-4" x-text="stripHtml(article.title)"></h2>
                            <p class="text-[14px] text-gray-300 line-clamp-2 md:line-clamp-3 pr-4 leading-relaxed" x-text="stripHtml(article.content)"></p>
                            
                            
                        </div>`;

const newBlock = `<div class="mb-4 md:mb-5 relative overflow-hidden bg-[#111827] rounded-2xl cursor-pointer group border border-white/5 hover:border-white/20 transition-all shadow-lg" :class="[
                            (isMobile && mobileActiveCard === article.link) ? 'ring-2 ring-emerald-500' : '',
                            readStates.includes(article.link) ? 'opacity-60 grayscale-[50%]' : ''
                        ]" @click="handleCardClick(article, $event)">
                        
                        <!-- Background Image with Gradient Overlay -->
                        <div class="absolute inset-y-0 right-0 w-[55%] md:w-[50%] z-0" x-show="article.image">
                            <img :src="article.image" loading="lazy" class="w-full h-full object-cover opacity-100" style="-webkit-mask-image: linear-gradient(to right, transparent, black 30%); mask-image: linear-gradient(to right, transparent, black 30%);">
                            <div class="absolute inset-0 bg-gradient-to-r from-[#111827] via-transparent to-transparent"></div>
                        </div>

                        <!-- Content over background -->
                        <div class="relative z-10 flex flex-col p-4 md:p-8 w-[65%] md:w-[65%] min-h-[180px] md:min-h-[220px] justify-center">
                            <div class="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-[11px] font-bold tracking-wider mb-2.5 md:mb-4 uppercase">
                                <span class="flex items-center gap-1.5 md:gap-2 bg-[#0B101E]/60 backdrop-blur px-2 py-1 md:px-2.5 md:py-1 rounded-md text-emerald-400 border border-emerald-500/10">
                                    <img :src="article.feedIcon || \`https://icons.duckduckgo.com/ip3/\${new URL(article.link).hostname}.ico\`" class="w-3.5 h-3.5 md:w-4 md:h-4 rounded" @error="$el.style.display='none'">
                                    <span x-text="stripHtml(article.feedTitle)" class="truncate max-w-[80px] md:max-w-none"></span>
                                </span>
                                <span class="text-white/20 hidden md:inline">•</span>
                                <span class="text-gray-400 whitespace-nowrap" x-text="timeAgo(article.pubDate)"></span>
                            </div>
                            
                            <h2 class="text-[17px] md:text-[26px] font-extrabold text-white leading-tight md:leading-tight mb-2 md:mb-3 drop-shadow-md pr-2 md:pr-4" x-text="stripHtml(article.title)"></h2>
                            <p class="text-[13px] md:text-[14px] text-gray-300 line-clamp-3 md:line-clamp-3 pr-2 md:pr-4 leading-snug md:leading-relaxed" x-text="stripHtml(article.content)"></p>
                            
                            
                        </div>`;

if (!html.includes(oldBlock)) {
    console.error("Old block not found!");
} else {
    html = html.replace(oldBlock, newBlock);
    fs.writeFileSync('index.html', html);
    console.log("Replacements done!");
}

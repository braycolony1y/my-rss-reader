const html = `
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-carousel">
        <a href="url" class="embedded-suggested-card" target="_blank">
            <img src="img.jpg" class="embedded-suggested-image" alt="">
            <div class="embedded-suggested-content">
                <div class="embedded-suggested-title">Test Title</div>
            </div></a>
    </div>
</div>`;

let cleaned = html;
const protectedLinks = [];
cleaned = cleaned.replace(/<a\b[^>]*class=["'][^"']*(?:font-bold text-gray-900|embedded-suggested-card)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, (match) => {
    protectedLinks.push(match);
    return `__PROTECTED_LINK_${protectedLinks.length - 1}__`;
});

console.log("Protected Links Length:", protectedLinks.length);

for (let i = 0; i < 3; i++) cleaned = cleaned.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
cleaned = cleaned.replace(/<\/?a\b[^>]*>/gi, '');
for (let i = 0; i < protectedLinks.length; i++) {
    cleaned = cleaned.replace(`__PROTECTED_LINK_${i}__`, protectedLinks[i]);
}

console.log("Final HTML contains a tag:", cleaned.includes('<a '));
console.log("Final HTML contains card class:", cleaned.includes('embedded-suggested-card'));

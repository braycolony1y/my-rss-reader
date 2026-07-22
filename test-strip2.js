let html = `
<div class="embedded-suggested-carousel">
    <a href="https://vietnamnet.vn/" class="embedded-suggested-card" target="_blank">
        <img src="img.jpg" class="embedded-suggested-image" alt="">
        <div class="embedded-suggested-content">
            <div class="embedded-suggested-title">Title</div>
        </div>
    </a>
</div>
`;
const protectedLinks = [];
html = html.replace(/<a\b[^>]*class=["'][^"']*(?:font-bold text-gray-900|embedded-suggested-card)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, (match) => {
    protectedLinks.push(match);
    return `__PROTECTED_LINK_${protectedLinks.length - 1}__`;
});
console.log('After protection:', html);

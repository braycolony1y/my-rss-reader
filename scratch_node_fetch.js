import fetch from 'node-fetch';
fetch('https://znews.vn/messi-mach-trong-tai-cucurella-che-mieng-post1670785.html').then(r => r.text()).then(html => {
    const match = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    console.log(match ? match[1] : 'no og:image');
});

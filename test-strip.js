import fs from 'fs';

const server = fs.readFileSync('server.js', 'utf8');
const match = server.match(/function cleanArticleMarkup\(markup\) \{([\s\S]*?)\n\}/);
const cleanArticleMarkup = new Function('markup', match[1]);

const html = `
<div class="embedded-suggested-carousel">
    <a href="https://vietnamnet.vn/" class="embedded-suggested-card" target="_blank">
        <img src="img.jpg" class="embedded-suggested-image" alt="">
        <div class="embedded-suggested-content">
            <div class="embedded-suggested-title">Title</div>
        </div>
    </a>
</div>
`;
console.log(cleanArticleMarkup(html));

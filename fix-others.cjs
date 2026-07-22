const fs = require('fs');
const files = [
    './src/sources/ThanhNienSource.js',
    './src/sources/TuoitreSource.js',
    './src/sources/ZnewsSource.js',
    './src/sources/NhanDanSource.js',
    './src/sources/VtvSource.js'
];

for (const path of files) {
    if (fs.existsSync(path)) {
        let content = fs.readFileSync(path, 'utf8');
        
        // Remove the old createCardHtml (both variants if any exists)
        content = content.replace(/const createCardHtml = \([\s\S]*?<\/a>`;\s*};/g, `const createCardHtml = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            return \`
            <a href="\${absUrl}" class="embedded-suggested-card font-bold text-gray-900" target="_blank">
                \${img ? \`<img src="\${img}" class="embedded-suggested-image" alt="">\` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">\${title}</div>
                    \${desc ? \`<div class="embedded-suggested-summary">\${desc}</div>\` : ''}
                </div>
            </a>\`;
        };`);
        
        fs.writeFileSync(path, content);
        console.log(`Updated ${path}`);
    }
}

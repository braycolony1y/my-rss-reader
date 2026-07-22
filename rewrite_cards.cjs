const fs = require('fs');
const path = require('path');
const dir = 'src/sources';

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const p = path.join(dir, file);
    let c = fs.readFileSync(p, 'utf8');

    // For createCardHtml in all custom sources
    // Old:
    // <a href="${absUrl}" class="embedded-suggested-card" target="_blank">
    //     ${img ? `<img src="${img}" class="embedded-suggested-image" alt="">` : ''}
    //     <div class="embedded-suggested-content">
    //         <div class="embedded-suggested-title">${title}</div>
    //         ${desc ? `<div class="embedded-suggested-summary">${desc}</div>` : ''}
    //     </div></a>`;
    
    // We will use a regex to replace this block.
    c = c.replace(/<a href=["']\$\{absUrl\}["'] class=["']embedded-suggested-card["'] target=["']_blank["']>\s*\$\{img \? `<img src="\$\{img\}" class="embedded-suggested-image" alt="">` : ''\}\s*<div class=["']embedded-suggested-content["']>\s*<div class=["']embedded-suggested-title["']>\$\{title\}<\/div>(?:\s*\$\{desc \? `<div class="embedded-suggested-summary">\$\{desc\}<\/div>` : ''\})?\s*<\/div><\/a>/g, 
        `<div class="embedded-suggested-card" style="position: relative;">
                <a href="\${absUrl}" target="_blank" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;"></a>
                \${img ? \`<img src="\${img}" class="embedded-suggested-image" alt="">\` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">\${title}</div>
                    \${desc ? \`<div class="embedded-suggested-summary">\${desc}</div>\` : ''}
                </div></div>`);
                
    // For VietnamnetSource.js which doesn't use createCardHtml
    c = c.replace(/<a href=["']\$\{item\.href\}["'] class=["']embedded-suggested-card["'] target=["']_blank["']>\s*\$\{item\.img \? `<img src="\$\{item\.img\}" class="embedded-suggested-image" alt="">` : ''\}\s*<div class=["']embedded-suggested-content["']>\s*<div class=["']embedded-suggested-title["']>\$\{item\.title\}<\/div>\s*\$\{item\.desc \? `<div class="embedded-suggested-summary">\$\{item\.desc\}<\/div>` : ''\}\s*<\/div><\/a>/g,
        `<div class="embedded-suggested-card" style="position: relative;">
                        <a href="\${item.href}" target="_blank" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;"></a>
                        \${item.img ? \`<img src="\${item.img}" class="embedded-suggested-image" alt="">\` : ''}
                        <div class="embedded-suggested-content">
                            <div class="embedded-suggested-title">\${item.title}</div>
                            \${item.desc ? \`<div class="embedded-suggested-summary">\${item.desc}</div>\` : ''}
                        </div></div>`);

    fs.writeFileSync(p, c);
}

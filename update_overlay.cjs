const fs = require('fs');
const path = require('path');
const dir = 'src/sources';

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const p = path.join(dir, file);
    let c = fs.readFileSync(p, 'utf8');

    // Replace the style="position: relative;" on the container
    c = c.replace(/<div class=["']embedded-suggested-card["'] style=["']position: relative;["']>/g, '<div class="embedded-suggested-card">');
    
    // Replace the style="..." on the a tag with class="embedded-suggested-overlay"
    c = c.replace(/<a href=["'](\$\{[^}]+\})["'] target=["']_blank["'] style=["']position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;["']><\/a>/g, 
        '<a href="$1" target="_blank" class="embedded-suggested-overlay"></a>');

    fs.writeFileSync(p, c);
}

const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

const regex = /\/\/ XenForo forums such as VOZ wrap each post in a large <article>[\s\S]*?result\.siteName = result\.siteName \|\| 'The Verge';\n    \} else \{/;

if (!regex.test(server)) {
    console.error("Could not find the block to replace.");
    process.exit(1);
}

const replacement = `
    let sourceHandler = sourceRegistry.getHandler(url);
    if (sourceHandler && sourceHandler.parseArticleHtmlContent) {
        articleHtml = sourceHandler.parseArticleHtmlContent(html, url, result, { escapeHtml, extractBalancedElementByClass });
    } else {`;

server = server.replace(regex, replacement);

fs.writeFileSync('server.js', server);
console.log("Successfully replaced block.");

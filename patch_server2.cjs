const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

const regex2 = /    if \(hostname\.includes\('vietnamnet\.vn'\)\) \{\n        const vnnEmbeds = \[\.\.\.html\.matchAll\(\/<iframe\[\^>\]\*src=\["'\]\(https:\\\/\\\/embed\\\.vietnamnet\\\.vn\\\/\[\^"'\]\+\)\["'\]\[\^>\]\*>\/gi\)\];\n        for \(const match of vnnEmbeds\) \{\n            try \{\n                const embedRes = await fetchWithTimeout\(match\[1\], \{ headers: \{ 'Referer': 'https:\/\/vietnamnet\.vn\/' \} \}, 3000\);\n                if \(embedRes\.ok\) \{\n                    const embedHtml = await embedRes\.text\(\);\n                    const mp4Match = embedHtml\.match\(\/var\\s\+mp4\\s\*=\\s\*\['"\]\(\[\^'"\]\+\\\.mp4\[\^'"\]\*\)\['"\]\/i\);\n                    if \(mp4Match\) \{\n                        const mp4Url = mp4Match\[1\];\n                        html = html\.replace\(match\[0\], \`<video src="\$\{mp4Url\}" controls playsinline><\/video>\`\);\n                    \}\n                \}\n            \} catch\(e\) \{\}\n        \}\n    \}\n/;

if (!regex2.test(server)) {
    console.error("Could not find the vietnamnet block.");
} else {
    server = server.replace(regex2, `    let sourceHandler = sourceRegistry.getHandler(url);\n    if (sourceHandler && sourceHandler.preProcessHtml) {\n        html = await sourceHandler.preProcessHtml(html, { fetchWithTimeout });\n    }\n\n`);
    fs.writeFileSync('server.js', server);
    console.log("Successfully replaced vietnamnet block.");
}

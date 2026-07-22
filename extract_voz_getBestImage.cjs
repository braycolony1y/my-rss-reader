const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

const regex = /        let isVoz = targetUrl\.includes\('voz\.vn'\);\n        let html = '';\n        let ok = false;\n\n        if \(isVoz\) \{\n            try \{\n                let directHtml = await fetchWithCookies\(targetUrl, 6000\);\n                if \(directHtml && !directHtml\.includes\('Just a moment'\)\) \{\n                    html = directHtml;\n                    ok = true;\n                \}\n            \} catch \(e\) \{ \}\n        \}\n\n        if \(!ok\) \{\n            let fetchUrl = CF_PROXY_BASE \+ encodeURIComponent\(targetUrl\);\n            const res = await fetchFn\(fetchUrl\);\n            if \(!res\.ok\) \{\n                if \(rssFallback && !isInvalidImage\(rssFallback\)\) return rssFallback;\n                return null;\n            \}\n            html = await res\.text\(\);\n        \}\n        let scopeHtml = html;\n\n        if \(isVoz\) \{[\s\S]*?if \(rssFallback && !isInvalidImage\(rssFallback\)\) return rssFallback;\n        \}/;

let sourceHandlerCall = `
        let sourceHandler = sourceRegistry.getHandler(targetUrl);
        if (sourceHandler && sourceHandler.getBestImage) {
            let handledImg = await sourceHandler.getBestImage(targetUrl, fetchFn, rssFallback, { extractImageFromHtml, fetchWithCookies, isInvalidImage, CF_PROXY_BASE });
            if (handledImg) return handledImg;
        }

        let fetchUrl = CF_PROXY_BASE + encodeURIComponent(targetUrl);
        const res = await fetchFn(fetchUrl);
        if (!res.ok) {
            if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
            return null;
        }
        let html = await res.text();
        let scopeHtml = html;
`;

if (regex.test(server)) {
    server = server.replace(regex, sourceHandlerCall);
    fs.writeFileSync('server.js', server);
    console.log("Patched getBestImage.");
} else {
    console.log("Could not find getBestImage voz logic.");
}


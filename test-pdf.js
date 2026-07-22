async function fetchPdfCreationDate(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { headers: { "Range": "bytes=-32768" }, signal: controller.signal });
        let text = "";
        let bytesRead = 0;
        // Node 18+ fetch body is an async iterable or has getReader if web streams
        if (res.body && typeof res.body.getReader === "function") {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                text += decoder.decode(value, { stream: true });
                bytesRead += value.length;
                const match = text.match(/CreationDate\s*\(\s*D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([-+\d'"Z]*)/);
                if (match) {
                    controller.abort();
                    clearTimeout(timeout);
                    let iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
                    let tz = match[7];
                    if (tz) {
                        if (tz.includes("Z")) iso += "Z";
                        else {
                            let signMatch = tz.match(/([-+])(\d{2})'?(\d{2})?'?/);
                            if (signMatch) iso += `${signMatch[1]}${signMatch[2]}:${signMatch[3] || "00"}`;
                            else iso += "Z";
                        }
                    } else iso += "Z";
                    let d = new Date(iso);
                    if (!isNaN(d.getTime())) return d.toISOString();
                    break;
                }
                if (res.status !== 206 && bytesRead > 5 * 1024 * 1024) {
                    controller.abort();
                    break;
                }
            }
        }
        clearTimeout(timeout);
    } catch(e) { console.error(e.message); }
    return null;
}
fetchPdfCreationDate("https://www.uob.com.vn/assets/web-resources/privilege/pdf/en/uobv-market-outlook-1h-2026.pdf").then(console.log);

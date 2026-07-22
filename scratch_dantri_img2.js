const html = `<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1280'><rect x='0' y='0' /></svg>" data-src="real-src.jpg">`;

let result1 = html.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
    return 'MATCH1:' + attrs;
});

let result2 = html.replace(/<img\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/gi, (match, attrs) => {
    return 'MATCH2:' + attrs;
});

console.log(result1);
console.log(result2);

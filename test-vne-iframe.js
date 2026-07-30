import fs from 'fs';
let html = `<iframe sandbox frameborder="0" height="500" scrolling="no" data-src="https://flo.uri.sh/visualisation/29758037/embed" width="100%">`;
html = html.replace(/<iframe\b[^>]*>/gi, (el) => {
    return el.replace(/\bsandbox\b(?:=["'][^"']*["'])?/i, '');
});
console.log(html);

let html = `<div class="bbTable">
<table style='width: 820px'><tr><td>
<img src="data:image" style="width: 860px" alt="Lanh_dao_PNJ_znews_6973.jpg" width="960" height="640" />
</td></tr><tr><td></td></tr></table>
<span style="color: rgb(68, 68, 68)">[td]<span style="color: rgb(68, 68, 68)">Ông Phan Quốc Công.</span>[/td]</span></div>`;

html = html.replace(/<(span|div|table|td|tr|p|b|i|u|tbody|thead|th|img)\b([^>]*)>/gi, (m, tag, rest) => {
    rest = rest.replace(/\sstyle=(["'])[\s\S]*?\1/gi, '');
    if (/^(table|td|img|th)$/i.test(tag)) {
        rest = rest.replace(/\swidth=(["'])[\s\S]*?\1/gi, '');
        rest = rest.replace(/\sheight=(["'])[\s\S]*?\1/gi, '');
    }
    return `<${tag}${rest}>`;
});

console.log(html);

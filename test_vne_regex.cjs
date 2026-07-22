let html = `<p class="Normal" style="text-align:right;"><strong>Đức Hùng</strong></p><span id="article-end"></span>`;
html = html.replace(/<p\b[^>]*class=["'][^"']*(?:author_mail|Normal)[^"']*["'][^>]*text-align:\s*right[^>]*>\s*(?:<strong>|<b>)[\s\S]*?(?:<\/strong>|<\/b>)\s*<\/p>/gi, '');
html = html.replace(/<p\b[^>]*>\s*(?:<strong>|<b>)\s*([^<]+)\s*(?:<\/strong>|<\/b>)\s*<\/p>(?=\s*(?:<span\b[^>]*id=["']article-end|<\/article>))/gi, '');
console.log("Result: '" + html + "'");

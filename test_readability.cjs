const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('sggp.html', 'utf8');
const doc = new JSDOM(html, { url: 'https://www.sggp.org.vn' }).window.document;
const reader = new Readability(doc);
const article = reader.parse();
console.log(article.content.includes('video') ? "Video found!" : "No video!");
console.log("Videos:", article.content.match(/<video[^>]*>[\s\S]*?<\/video>/gi));

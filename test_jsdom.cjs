const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "outside-only" });
const window = dom.window;

const body = window.document.querySelector('body');
body.classList.add('theme-glass-light');

const panel = window.document.querySelector('.article-overlay-panel');
const style = window.getComputedStyle(panel);
console.log("Panel background:", style.getPropertyValue('background'));
console.log("Panel backdrop-filter:", style.getPropertyValue('backdrop-filter'));

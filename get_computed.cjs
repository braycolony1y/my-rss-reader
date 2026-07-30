const fs = require('fs');
const { JSDOM } = require("jsdom");
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

// Mock AlpineJS state
const body = document.querySelector('body');
body.className = "font-sans antialiased h-[100dvh] overflow-hidden flex selection:bg-blue-500/30 theme-glass-light text-gray-800";

const overlayRoot = document.createElement('div');
overlayRoot.className = "article-overlay-root fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-6";

const backdrop = document.createElement('div');
backdrop.className = "article-overlay-backdrop absolute inset-0 bg-[#0B101E]/80 backdrop-blur-sm";
overlayRoot.appendChild(backdrop);

const panel = document.createElement('div');
panel.className = "article-overlay-panel relative w-full h-[100dvh] md:w-[90%] md:max-w-[720px] md:h-[85vh] md:max-h-[85vh] md:rounded-3xl bg-[#111827] shadow-2xl flex flex-col overflow-hidden";
overlayRoot.appendChild(panel);

body.appendChild(overlayRoot);

const computedPanel = dom.window.getComputedStyle(panel);
console.log("Panel background:", computedPanel.getPropertyValue('background'));
console.log("Panel background-color:", computedPanel.getPropertyValue('background-color'));

const computedBackdrop = dom.window.getComputedStyle(backdrop);
console.log("Backdrop background:", computedBackdrop.getPropertyValue('background'));
console.log("Backdrop background-color:", computedBackdrop.getPropertyValue('background-color'));

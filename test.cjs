const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Replace the specific background overrides with attribute selectors for bg-[#0B101E], bg-[#111827], etc.
const oldCSS = `.theme-glass-light .bg-\\[\\#111827\\], .theme-glass-light .bg-\\[\\#0B101E\\]\\/65, .theme-glass-light .bg-gray-800, .theme-glass-light .bg-\\[\\#1e1e1e\\], .theme-glass-light .bg-\\[\\#121212\\] {
            background: rgba(255, 255, 255, 0.45) !important;
            backdrop-filter: blur(40px) saturate(150%);
            -webkit-backdrop-filter: blur(40px) saturate(150%);
            border: 1px solid rgba(255, 255, 255, 0.6) !important;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07), inset 0 1px 1px rgba(255, 255, 255, 1) !important;
        }
        .theme-glass-light .bg-\\[\\#0B101E\\] {
            background: transparent !important;
        }`;

const newCSS = `        .theme-glass-light [class*="bg-[#111827]"],
        .theme-glass-light [class*="bg-[#0B101E]"],
        .theme-glass-light [class*="bg-[#121212]"],
        .theme-glass-light [class*="bg-[#1e1e1e]"],
        .theme-glass-light [class*="bg-gray-800"] {
            background: rgba(255, 255, 255, 0.45) !important;
            backdrop-filter: blur(40px) saturate(150%);
            -webkit-backdrop-filter: blur(40px) saturate(150%);
            border: 1px solid rgba(255, 255, 255, 0.6) !important;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07), inset 0 1px 1px rgba(255, 255, 255, 1) !important;
        }
        /* Fix the thumbnail gradient */
        .theme-glass-light [class*="from-[#111827]"] {
            --tw-gradient-from: rgba(255, 255, 255, 0.8) var(--tw-gradient-from-position) !important;
            --tw-gradient-to: rgba(255, 255, 255, 0) var(--tw-gradient-to-position) !important;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
        }
        .theme-glass-light [class*="via-[#111827]"] {
            --tw-gradient-via: rgba(255, 255, 255, 0.4) var(--tw-gradient-via-position) !important;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to) !important;
        }`;

html = html.replace(oldCSS, newCSS);
fs.writeFileSync('index.html', html);
console.log('done');

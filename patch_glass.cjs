const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const newCSS = `        .theme-glass {
            background: linear-gradient(135deg, #1b2838 0%, #0d1217 50%, #17242d 100%) !important;
            background-attachment: fixed !important;
        }
        /* Target all dark background variations for dark glass mode */
        .theme-glass [class*="bg-[#111827]"],
        .theme-glass [class*="bg-[#0B101E]"],
        .theme-glass [class*="bg-[#121212]"],
        .theme-glass [class*="bg-[#1e1e1e]"],
        .theme-glass [class*="bg-gray-800"] {
            background: rgba(17, 24, 39, 0.4) !important;
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.05) !important;
        }
        /* Make the main container completely transparent so the body gradient shows through */
        .theme-glass [class*="bg-[#0A0F1A]"],
        .theme-glass-light [class*="bg-[#0A0F1A]"] {
            background: transparent !important;
            backdrop-filter: none !important;
            border: none !important;
            box-shadow: none !important;
        }
        .theme-glass .text-\\[\\#d4d4d4\\] {
            color: #f3f4f6 !important;
        }

        .theme-glass-light {
            background: linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%) !important;
            background-attachment: fixed !important;
            color: #1a202c !important;
        }
        .theme-glass-light [class*="bg-[#111827]"],
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

// Find the start and end of the CSS block to replace
const startIndex = html.indexOf('.theme-glass {');
const endIndex = html.indexOf('/* Override text colors globally for light mode */');

if (startIndex !== -1 && endIndex !== -1) {
    html = html.substring(0, startIndex) + newCSS + '\n        ' + html.substring(endIndex);
    fs.writeFileSync('index.html', html);
    console.log('Replaced successfully');
} else {
    console.log('Could not find boundaries');
}

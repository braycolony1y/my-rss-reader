const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const oldCSS = `
        .theme-glass-light {
            background: linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%) !important;
            background-attachment: fixed !important;
            color: #1a202c !important;
        }
        .theme-glass-light .bg-\\[\\#111827\\], .theme-glass-light .bg-\\[\\#0B101E\\]\\/65, .theme-glass-light .bg-gray-800, .theme-glass-light .bg-\\[\\#1e1e1e\\], .theme-glass-light .bg-\\[\\#121212\\] {
            background: rgba(255, 255, 255, 0.4) !important;
            backdrop-filter: blur(40px) saturate(150%);
            -webkit-backdrop-filter: blur(40px) saturate(150%);
            border: 1px solid rgba(255, 255, 255, 0.8) !important;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07), inset 0 1px 1px rgba(255, 255, 255, 1) !important;
        }
        .theme-glass-light .bg-\\[\\#0B101E\\] {
            background: transparent !important;
        }
        .theme-glass-light .text-\\[\\#d4d4d4\\], .theme-glass-light .text-gray-200, .theme-glass-light .text-white, .theme-glass-light .text-gray-400 {
            color: #2d3748 !important;
        }
        .theme-glass-light .text-gray-500 {
            color: #4a5568 !important;
        }
        .theme-glass-light input::placeholder {
            color: #718096 !important;
        }
        .theme-glass-light .border-white\\/10 {
            border-color: rgba(0, 0, 0, 0.1) !important;
        }
`;

const newCSS = `
        .theme-glass-light {
            background: linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%) !important;
            background-attachment: fixed !important;
            color: #1a202c !important;
        }
        .theme-glass-light .bg-\\[\\#111827\\], .theme-glass-light .bg-\\[\\#0B101E\\]\\/65, .theme-glass-light .bg-gray-800, .theme-glass-light .bg-\\[\\#1e1e1e\\], .theme-glass-light .bg-\\[\\#121212\\] {
            background: rgba(255, 255, 255, 0.45) !important;
            backdrop-filter: blur(40px) saturate(150%);
            -webkit-backdrop-filter: blur(40px) saturate(150%);
            border: 1px solid rgba(255, 255, 255, 0.6) !important;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07), inset 0 1px 1px rgba(255, 255, 255, 1) !important;
        }
        .theme-glass-light .bg-\\[\\#0B101E\\] {
            background: transparent !important;
        }
        /* Override text colors globally for light mode */
        .theme-glass-light .text-\\[\\#d4d4d4\\], .theme-glass-light .text-gray-200, .theme-glass-light .text-white, .theme-glass-light .text-gray-400, .theme-glass-light .text-gray-300 {
            color: #2d3748 !important;
        }
        .theme-glass-light .text-gray-500 {
            color: #4a5568 !important;
        }
        /* Except for primary colored buttons */
        .theme-glass-light button.bg-\\[\\#2a6049\\], 
        .theme-glass-light button.bg-\\[\\#1e293b\\], 
        .theme-glass-light button.bg-emerald-600, 
        .theme-glass-light button.bg-blue-600,
        .theme-glass-light a.bg-emerald-600 {
            color: #ffffff !important;
        }
        /* Also restore white text for buttons with .text-white inside those backgrounds */
        .theme-glass-light button.bg-\\[\\#2a6049\\] .text-white, 
        .theme-glass-light button.bg-\\[\\#1e293b\\] .text-white, 
        .theme-glass-light button.bg-emerald-600 .text-white, 
        .theme-glass-light button.bg-blue-600 .text-white,
        .theme-glass-light a.bg-emerald-600 .text-white {
            color: #ffffff !important;
        }
        
        /* Fix hover states */
        .theme-glass-light .hover\\:text-white:hover {
            color: #1a202c !important;
        }
        .theme-glass-light .hover\\:bg-white\\/10:hover, .theme-glass-light .hover\\:bg-white\\/\\[0\\.06\\]:hover {
            background-color: rgba(0, 0, 0, 0.05) !important;
        }
        .theme-glass-light .bg-white\\/\\[0\\.03\\] {
            background-color: rgba(0, 0, 0, 0.02) !important;
        }

        /* Fix border colors */
        .theme-glass-light .border-white\\/10, .theme-glass-light .border-white\\/5 {
            border-color: rgba(0, 0, 0, 0.1) !important;
        }

        /* Fix placeholder */
        .theme-glass-light input::placeholder {
            color: #718096 !important;
        }

        /* Highlight colors for light mode */
        .theme-glass-light .text-emerald-400 {
            color: #059669 !important;
        }
        .theme-glass-light .bg-emerald-500\\/20 {
            background-color: rgba(5, 150, 105, 0.15) !important;
        }
        .theme-glass-light .border-emerald-500\\/30 {
            border-color: rgba(5, 150, 105, 0.3) !important;
        }
        .theme-glass-light .text-amber-300 {
            color: #d97706 !important;
        }
        .theme-glass-light .border-amber-400\\/30 {
            border-color: rgba(217, 119, 6, 0.3) !important;
        }
        .theme-glass-light .text-teal-400, .theme-glass-light .text-teal-300 {
            color: #0f766e !important;
        }
        .theme-glass-light .bg-teal-900\\/40, .theme-glass-light .bg-teal-900\\/70 {
            background-color: rgba(13, 148, 136, 0.15) !important;
        }
        .theme-glass-light .text-blue-400 {
            color: #2563eb !important;
        }
        .theme-glass-light .bg-blue-900\\/40 {
            background-color: rgba(37, 99, 235, 0.15) !important;
        }
        .theme-glass-light .border-blue-500\\/30 {
            border-color: rgba(37, 99, 235, 0.3) !important;
        }
        .theme-glass-light .text-orange-400 {
            color: #ea580c !important;
        }
        .theme-glass-light .bg-orange-900\\/40 {
            background-color: rgba(234, 88, 12, 0.15) !important;
        }
        .theme-glass-light .border-orange-500\\/30 {
            border-color: rgba(234, 88, 12, 0.3) !important;
        }
`;

if (html.includes('.theme-glass-light {')) {
    html = html.replace(oldCSS, newCSS);
    fs.writeFileSync('index.html', html);
    console.log("Patched successfully");
} else {
    console.log("Could not find oldCSS to replace");
}

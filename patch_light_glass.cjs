const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Add theme-glass-light CSS
const newCSS = `
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
html = html.replace('</style>', newCSS + '</style>');

// 2. Update body :class logic
const oldBodyClass = `:class="theme === 'glass' ? 'theme-glass text-gray-200' : 'bg-[#1e1e1e] text-[#d4d4d4]'"`;
const newBodyClass = `:class="theme === 'glass' ? 'theme-glass text-gray-200' : (theme === 'glass-light' ? 'theme-glass-light text-gray-800' : 'bg-[#1e1e1e] text-[#d4d4d4]')"`;
html = html.replace(oldBodyClass, newBodyClass);

// 3. Update Toggle Theme Button
const oldButton = `<button @click="theme = theme === 'glass' ? 'classic' : 'glass'; localStorage.setItem('theme', theme)" class="hover:text-white transition p-1.5 md:p-2 rounded-full border border-white/10 bg-[#111827]" title="Toggle Theme">`;
const newButton = `<button @click="theme = theme === 'glass' ? 'glass-light' : (theme === 'glass-light' ? 'classic' : 'glass'); localStorage.setItem('theme', theme)" class="hover:text-white transition p-1.5 md:p-2 rounded-full border border-white/10 bg-[#111827]" title="Toggle Theme (Classic -> Dark Glass -> Light Glass)">`;
html = html.replace(oldButton, newButton);

// Update icon svgs inside the button to cycle
const oldSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <!-- Beaker/Glass icon -->
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>`;
const newSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <!-- Classic -> Dark Glass -> Light Glass icons -->
                            <path x-show="theme === 'classic'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                            <path x-show="theme === 'glass'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            <path x-show="theme === 'glass-light'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>`;
html = html.replace(oldSvg, newSvg);

fs.writeFileSync('index.html', html);

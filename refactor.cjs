const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Refactor Modal Layout
// From: flex justify-end
html = html.replace(
    'class="article-overlay-root fixed inset-0 z-[80] flex justify-end"',
    'class="article-overlay-root fixed inset-0 z-[80] flex justify-center items-center p-2 md:p-8"'
);

// Update modal panel styles
// From: class="bg-[#121212] w-full max-w-4xl max-h-[100dvh] flex flex-col shadow-2xl overflow-hidden"
html = html.replace(
    'class="bg-[#121212] w-full max-w-4xl max-h-[100dvh] flex flex-col shadow-2xl overflow-hidden"',
    'class="apple-modal-panel w-full max-w-[760px] max-h-[95dvh] md:max-h-[100dvh] flex flex-col shadow-2xl overflow-hidden rounded-[24px] md:rounded-[32px] border transition-transform transform"'
);

// 2. Add Apple Liquid Glass CSS
const oldCssMatch = html.match(/\.theme-glass \{[\s\S]*?\/\* Override text colors globally for light mode \*\//);
if (oldCssMatch) {
    const newCss = `.theme-glass, .theme-glass-light {
            /* Common Liquid Glass variables */
            --apple-blur: blur(24px);
            --apple-saturate: saturate(190%);
        }

        .theme-glass {
            background: radial-gradient(circle at 10% 20%, #201a30 0%, #0d1217 40%, #0d1217 100%) !important;
            background-attachment: fixed !important;
            color: #ffffff !important;
        }
        
        .theme-glass-light {
            background: radial-gradient(circle at 10% 20%, #fdfbfb 0%, #ebedee 100%) !important;
            background-attachment: fixed !important;
            color: #1d1d1f !important;
        }

        /* Unified Liquid Glass Overrides */
        .theme-glass [class*="bg-[#111827]"], .theme-glass [class*="bg-[#0B101E]"], .theme-glass [class*="bg-[#121212]"], .theme-glass [class*="bg-[#1e1e1e]"], .theme-glass [class*="bg-gray-800"] {
            background: rgba(40, 40, 40, 0.4) !important;
            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-top: 1px solid rgba(255, 255, 255, 0.15) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3) !important;
        }

        .theme-glass-light [class*="bg-[#111827]"], .theme-glass-light [class*="bg-[#0B101E]"], .theme-glass-light [class*="bg-[#121212]"], .theme-glass-light [class*="bg-[#1e1e1e]"], .theme-glass-light [class*="bg-[#080F19]"], .theme-glass-light [class*="bg-gray-800"] {
            background: rgba(255, 255, 255, 0.65) !important;
            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            border: 1px solid rgba(255, 255, 255, 0.8) !important;
            border-bottom: 1px solid rgba(0, 0, 0, 0.05) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.8) !important;
        }

        /* Transparent main container */
        .theme-glass [class*="bg-[#0A0F1A]"], .theme-glass-light [class*="bg-[#0A0F1A]"] {
            background: transparent !important;
            backdrop-filter: none !important;
            border: none !important;
            box-shadow: none !important;
        }

        /* Modal Overlay Background */
        .theme-glass .article-overlay-backdrop {
            background: rgba(0, 0, 0, 0.5) !important;
            backdrop-filter: blur(10px) !important;
        }
        .theme-glass-light .article-overlay-backdrop {
            background: rgba(255, 255, 255, 0.3) !important;
            backdrop-filter: blur(10px) !important;
        }

        /* Article Reader Modal (Apple Style) */
        .theme-glass .apple-modal-panel {
            background: rgba(30, 30, 30, 0.75) !important;
            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            box-shadow: 0 24px 48px rgba(0,0,0,0.4) !important;
        }
        .theme-glass-light .apple-modal-panel {
            background: rgba(250, 250, 250, 0.85) !important;
            backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            -webkit-backdrop-filter: var(--apple-blur) var(--apple-saturate) !important;
            border: 1px solid rgba(255, 255, 255, 0.9) !important;
            box-shadow: 0 24px 48px rgba(0,0,0,0.1) !important;
        }

        /* Gradients */
        .theme-glass [class*="from-[#111827]"], .theme-glass-light [class*="from-[#111827]"] {
            --tw-gradient-from: rgba(0,0,0,0) var(--tw-gradient-from-position) !important;
        }
        .theme-glass [class*="via-[#111827]"], .theme-glass-light [class*="via-[#111827]"] {
            --tw-gradient-via: rgba(0,0,0,0) var(--tw-gradient-via-position) !important;
        }
        
        /* Clean up separators and heavy UI */
        .theme-glass .border-white\\/10, .theme-glass-light .border-white\\/10 {
            border-color: rgba(128, 128, 128, 0.1) !important;
        }
        
        /* Typography overrides for reading */
        .theme-glass-light .text-white, .theme-glass-light .text-gray-200 { color: #1d1d1f !important; }
        .theme-glass-light .text-gray-300 { color: #424245 !important; }
        .theme-glass-light .text-gray-400 { color: #86868b !important; }
        
        /* Neon color removal (Replace with Apple system colors or neutral) */
        .theme-glass .text-emerald-400, .theme-glass-light .text-emerald-400,
        .theme-glass .text-teal-400, .theme-glass-light .text-teal-400 {
            color: #34C759 !important; /* Apple Green */
        }
        
        .theme-glass .text-orange-400, .theme-glass-light .text-orange-400,
        .theme-glass .text-amber-300, .theme-glass-light .text-amber-300 {
            color: #FF9500 !important; /* Apple Orange */
        }

        .theme-glass .text-blue-400, .theme-glass-light .text-blue-400,
        .theme-glass .text-cyan-400, .theme-glass-light .text-cyan-400 {
            color: #007AFF !important; /* Apple Blue */
        }

        .theme-glass-light a.bg-emerald-600, .theme-glass-light button.bg-emerald-600,
        .theme-glass a.bg-emerald-600, .theme-glass button.bg-emerald-600 {
            background-color: #34C759 !important;
            color: #ffffff !important;
            border: none !important;
        }

        /* Search bar Apple Capsule */
        .theme-glass-light input[type="text"], .theme-glass input[type="text"] {
            border-radius: 20px !important;
        }

        /* Reset specific button colors to avoid black text on dark bg */
        .theme-glass-light button, .theme-glass-light a {
            color: inherit;
        }

        /* Override text colors globally for light mode */`;

    html = html.replace(oldCssMatch[0], newCss);
}

// 3. Update Hero Image Radius
html = html.replace('class="w-full object-cover max-h-[500px]"', 'class="w-full object-cover max-h-[500px] rounded-[24px]"');

// 4. Update Article Title in Modal
html = html.replace('text-2xl md:text-3xl font-extrabold text-white leading-tight mb-4', 'text-3xl md:text-4xl font-bold text-white leading-tight mb-6 mt-4 tracking-tight');

// 5. Update overall modal padding for reading
html = html.replace('class="p-5 md:p-8 flex-1 overflow-y-auto relative"', 'class="p-6 md:p-12 flex-1 overflow-y-auto relative article-content-area"');

// 6. Clean up audio controls (Capsule style)
html = html.replace('class="flex items-center gap-2 mb-6 p-3 rounded-xl bg-white/[0.03] border border-white/5"', 'class="flex items-center justify-between gap-3 mb-8 p-3 px-5 rounded-[24px] bg-white/10 backdrop-blur-md shadow-sm border border-white/10 w-max"');

// 7. Change close button position and style (Floating Apple style)
html = html.replace(
    'class="text-gray-400 hover:text-white transition p-1.5 rounded-lg hover:bg-white/10 flex-shrink-0" title="Close"',
    'class="text-gray-400 hover:text-gray-800 dark:hover:text-white transition p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex-shrink-0 bg-white/5 backdrop-blur-md" title="Close"'
);

// 8. Fix Article Cards border radii
html = html.replace(/rounded-2xl/g, 'rounded-[16px]');
html = html.replace(/rounded-xl/g, 'rounded-[12px]');

fs.writeFileSync('index.html', html);
console.log('Refactoring complete');

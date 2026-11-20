import { waitForGeminiWebModel } from './gemini-web-model-readiness.js';

// Gemini Web model and thinking-level selection.
// Live DOM verified on 2026-10-16 with both inline (narrow) and overlay (wide) menus.
const MODEL_IDS = Object.freeze({
    '3.5-flash-lite': {
        id: 'bard-mode-option-8c46e95b1a07cecc',
        name: '3.5 Flash-Lite'
    },
    // Gemini renamed the 3.8 Flash entry to "Everyday help" (2026-11-20).
    '3.8': {
        id: 'bard-mode-option-56fdd199312815e2',
        name: 'Everyday help',
        aliases: ['3.8 Flash']
    },
    '3.1-pro': {
        id: 'bard-mode-option-e6fa609c3fa255c0',
        name: '3.1 Pro'
    },
    '4-argon': {
        id: 'bard-mode-option-95a4c0abcba24364',
        name: '4 Argon'
    }
});

export function resolveGeminiWebMode(requestedMode = '3.8') {
    const input = String(requestedMode || '3.8').toLowerCase().trim();
    const match = input.match(/^(3\.5-flash-lite|3\.8|3\.1-pro|4-argon|4)(?:-(low|medium|high|think))?$/);
    const base = match?.[1] === '4' ? '4-argon' : (match?.[1] || '3.8');
    const suffix = match?.[2] || 'low';
    const level = suffix === 'think' ? 'high' : suffix;
    const model = MODEL_IDS[base];
    return {
        mode: match ? input : '3.8',
        modelId: model.id,
        modelName: model.name,
        modelNames: [model.name, ...(model.aliases || [])],
        thinkingLevel: level
    };
}

// Known thinking level names, lowest first. Used to pick the lowest level when
// the requested one is not offered (renamed levels sort by list position).
export const THINKING_LEVEL_ORDER = Object.freeze([
    'off', 'none', 'minimal', 'fast', 'low', 'standard', 'medium', 'high', 'extended'
]);
// The in-page reader below inlines the same level-name pattern.

const NON_MODEL_PATTERN = /^(auto|models?|more|upgrade\b.*|get\b.*)$/i;

// Models that can safely be chosen automatically: never Auto, upgrade
// prompts, disabled entries or unnamed rows.
export function selectableGeminiWebModels(models = []) {
    return models.filter(item => {
        const name = String(item?.name || '').replace(/\s+/g, ' ').trim();
        return name && !NON_MODEL_PATTERN.test(name) && !/upgrade|upsell/i.test(name) &&
            !item.upsell && !item.disabled;
    });
}

// Lowest offered level: the requested one when present, else by known rank,
// else the first in the list.
export function pickGeminiWebThinking(levels = [], requested) {
    const usable = levels.filter(item => !item.disabled);
    const exact = usable.find(item => item.level === requested);
    if (exact) return { item: exact, fallback: false };
    if (!usable.length) return { item: null, fallback: false };
    const rank = item => {
        const index = THINKING_LEVEL_ORDER.indexOf(item.level);
        return index === -1 ? Infinity : index;
    };
    const lowest = usable.reduce((best, item) => rank(item) < rank(best) ? item : best, usable[0]);
    return { item: rank(lowest) === Infinity ? usable[0] : lowest, fallback: true };
}

const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};

// All callbacks run in the real Gemini page through page.evaluate().
// Gemini renders the desktop thinking submenu in a *separate* CDK overlay.
// On narrow layouts it nests the options under the Thinking level item.
export async function readGeminiWebModeState(page) {
    return page.evaluate(() => {
        const visible = element => {
            if (!element || element.closest('[hidden],[aria-hidden="true"]')) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 0 && rect.height > 0;
        };
        const label = element => String(
            element?.querySelector?.('.label')?.textContent ||
            element?.innerText || element?.textContent || ''
        ).replace(/\s+/g, ' ').trim();
        const selected = element => !!element && (
            element.classList.contains('selected') ||
            element.getAttribute('aria-selected') === 'true' ||
            element.getAttribute('aria-checked') === 'true' ||
            element.getAttribute('aria-pressed') === 'true' ||
            !!element.querySelector('[aria-label="Selected"]')
        );
        const disabled = element =>
            element?.getAttribute('aria-disabled') === 'true' ||
            element?.hasAttribute('disabled');
        const menu = document.querySelector('[data-test-id="gem-mode-menu"]');
        if (!visible(menu)) {
            return {
                open: false, models: [], thinking: [], thinkingExpanded: false,
                selectedModelId: null, selectedThinking: null
            };
        }
        const models = [...menu.querySelectorAll(
            '[data-test-id^="bard-mode-option-"]'
        )].filter(visible).map(element => {
            const id = element.getAttribute('data-test-id') || '';
            const modeId = element.getAttribute('data-mode-id') || '';
            const upsell = /upsell[_-]/i.test(id) || /upsell[_-]/i.test(modeId);
            return {
                id,
                modeId,
                name: label(element),
                selected: selected(element),
                upsell,
                disabled: disabled(element) || upsell
            };
        });
        const trigger = [...menu.querySelectorAll(
            '[value="thinking_level"],[role="menuitem"]'
        )].find(element => /^Thinking level\b/i.test(label(element)));
        const thinking = [...document.querySelectorAll(
            'gem-menu-item,[role="menuitem"],[role="menuitemradio"],[role="option"]'
        )].filter(visible).map(element => {
            const name = label(element);
            const match = name.match(/^(Off|None|Minimal|Fast|Low|Standard|Medium|High|Extended)\b/i);
            if (!match) return null;
            return {
                level: match[1].toLowerCase(),
                label: name,
                selected: selected(element),
                disabled: disabled(element)
            };
        }).filter(Boolean);
        return {
            open: true,
            models,
            thinking,
            thinkingExpanded: trigger?.getAttribute('aria-expanded') === 'true',
            selectedModelId: models.find(item => item.selected)?.id || null,
            selectedModelName: models.find(item => item.selected)?.name || null,
            selectedThinking: thinking.find(item => item.selected)?.level || null
        };
    });
}

async function clickMenuOption(page, choice) {
    return page.evaluate(({ modelName, level }) => {
        const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 0 && rect.height > 0;
        };
        const menu = document.querySelector('[data-test-id="gem-mode-menu"]');
        if (!visible(menu)) return false;
        let option;
        if (modelName) {
            option = [...menu.querySelectorAll('[data-test-id^="bard-mode-option-"]')]
                .find(element => {
                    const name = String(element.querySelector('.label')?.textContent ||
                        element.innerText || element.textContent || '')
                        .replace(/\s+/g, ' ').trim().toLowerCase();
                    return visible(element) && name === modelName.toLowerCase();
                });
        } else {
            option = [...document.querySelectorAll(
                'gem-menu-item,[role="menuitem"],[role="menuitemradio"],[role="option"]'
            )].find(element => visible(element) &&
                String(
                    element.querySelector?.('.label')?.textContent ||
                    element.innerText || element.textContent || ''
                ).replace(/\s+/g, ' ').trim().toLowerCase() === level);
        }
        if (!option || option.getAttribute('aria-disabled') === 'true' ||
            option.hasAttribute('disabled') ||
            /upsell[_-]/i.test(option.getAttribute('data-test-id') || '') ||
            /upsell[_-]/i.test(option.getAttribute('data-mode-id') || '')) return false;
        option.click();
        return true;
    }, choice);
}

// Wide screens open a sibling overlay on hover; narrow screens expand inline
// on click. No viewport-width heuristics or screen coordinates are needed.
async function openThinkingLevel(page, openMenu, sleep) {
    await openMenu();
    let state = await readGeminiWebModeState(page);
    if (state.thinking.length >= 2) return state;

    const interaction = await page.evaluate(() => {
        const menu = document.querySelector('[data-test-id="gem-mode-menu"]');
        const trigger = [...(menu?.querySelectorAll(
            '[value="thinking_level"],[role="menuitem"]'
        ) || [])].find(element => {
            const name = String(
                element.querySelector('.label')?.textContent ||
                element.innerText || element.textContent || ''
            ).replace(/\s+/g, ' ').trim();
            return /^Thinking level\b/i.test(name);
        });
        if (!trigger) return 'missing';
        if (trigger.getAttribute('aria-expanded') === 'true') return 'expanded';
        if (trigger.getAttribute('aria-haspopup') === 'true') {
            for (const name of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) {
                trigger.dispatchEvent(new MouseEvent(name, {
                    bubbles: name.endsWith('over')
                }));
            }
            return 'hover';
        }
        trigger.click();
        return 'click';
    });
    if (interaction === 'missing') {
        throw fail('GEMINI_WEB_THINKING_MENU_NOT_FOUND',
            'Gemini Web Thinking level submenu was not found');
    }

    const waitOptions = async timeout => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            state = await readGeminiWebModeState(page);
            if (state.thinking.length >= 2) return true;
            await sleep(100);
        }
        return false;
    };
    if (await waitOptions(1300)) return state;

    // A synthetic hover can be ignored by a future Gemini UI version.
    // Click the trigger only after the hover and its animation have had time.
    if (interaction === 'hover' || interaction === 'expanded') {
        await page.evaluate(() => {
            const trigger = document.querySelector(
                '[data-test-id="gem-mode-menu"] [value="thinking_level"]'
            );
            if (trigger && trigger.getAttribute('aria-expanded') !== 'true') {
                trigger.click();
            }
        });
        if (await waitOptions(1300)) return state;
    }
    throw fail('GEMINI_WEB_THINKING_MENU_NOT_FOUND',
        'Gemini Web Thinking level options did not become visible');
}

async function waitForSelection({ page, openMenu, sleep, match, thinking, code, message }) {
    const deadline = Date.now() + 8000;
    let state;
    while (Date.now() < deadline) {
        await openMenu();
        if (thinking) await openThinkingLevel(page, openMenu, sleep);
        state = await readGeminiWebModeState(page);
        if (match(state)) return state;
        await sleep(100);
    }
    throw fail(code,
        message + '; last selected model=' + (state?.selectedModelId || 'none') +
        ', thinking=' + (state?.selectedThinking || 'none'));
}

export async function selectGeminiWebMode(page, requestedMode, { openMenu, closeMenu, sleep }) {
    const target = resolveGeminiWebMode(requestedMode);
    try {
        // Match the displayed label (menu IDs are account-specific). If the
        // configured label is not offered, fall back to the top selectable
        // non-Auto entry; fail closed only when there is none.
        const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const preferred = target.modelNames.map(norm);
        const isPreferred = item => preferred.includes(norm(item.name));
        let { state, model } = await waitForGeminiWebModel({
            readState: () => readGeminiWebModeState(page),
            openMenu, matches: isPreferred, sleep, timeoutMs: 2500
        });
        let modelFallback = false;
        if (!model || model.disabled || model.upsell) {
            const [first] = selectableGeminiWebModels(state.models);
            if (!first) {
                const available = state.models.map(item => item.name +
                    (item.upsell ? ' (upgrade required)' :
                        item.disabled ? ' (disabled)' : '')).join(', ') || '(none)';
                throw fail('GEMINI_WEB_MODEL_NOT_FOUND',
                    target.modelName + ' is not offered and no selectable non-Auto model exists' +
                    '. Visible options: ' + available +
                    '. Check GEMINI_WEB_URL and the OpenCLI browser profile.');
            }
            model = first;
            modelFallback = true;
            console.warn('[GEMINI WEB] ' + target.modelName + ' not offered; using "' +
                first.name + '" (top non-Auto model)');
        }
        const chosenName = model.name;
        const sameModel = item => norm(item.name) === norm(chosenName);
        if (!state.models.some(item => item.selected && sameModel(item))) {
            if (!await clickMenuOption(page, { modelName: chosenName })) {
                throw fail('GEMINI_WEB_MODEL_SELECT_FAILED', 'Could not click ' + chosenName);
            }
            state = await waitForSelection({
                page, openMenu, sleep,
                match: value => value.models.some(item => item.selected && sameModel(item)),
                code: 'GEMINI_WEB_MODEL_NOT_CONFIRMED',
                message: 'Could not verify ' + chosenName
            });
        }

        state = await openThinkingLevel(page, openMenu, sleep);
        const { item: thinking, fallback: thinkingFallback } =
            pickGeminiWebThinking(state.thinking, target.thinkingLevel);
        if (!thinking) {
            throw fail('GEMINI_WEB_THINKING_LEVEL_NOT_FOUND',
                'Gemini Web offers no selectable thinking level for ' + chosenName);
        }
        const level = thinking.level;
        if (thinkingFallback) {
            console.warn('[GEMINI WEB] ' + target.thinkingLevel + ' thinking not offered; using "' +
                level + '" (lowest available)');
        }
        if (state.selectedThinking !== level) {
            if (!await clickMenuOption(page, { level })) {
                throw fail('GEMINI_WEB_THINKING_SELECT_FAILED', 'Could not click ' + level + ' thinking');
            }
            await waitForSelection({
                page, openMenu, sleep, thinking: true,
                match: value => value.models.some(item => item.selected && sameModel(item)) &&
                    value.selectedThinking === level,
                code: 'GEMINI_WEB_THINKING_NOT_CONFIRMED',
                message: 'Could not verify ' + level + ' thinking'
            });
        }

        await openThinkingLevel(page, openMenu, sleep);
        const verified = await readGeminiWebModeState(page);
        if (!verified.models.some(item => item.selected && sameModel(item)) ||
            verified.selectedThinking !== level) {
            throw fail('GEMINI_WEB_MODEL_NOT_CONFIRMED',
                'Expected ' + chosenName + '/' + level +
                '; got ' + (verified.selectedModelId || 'none') +
                '/' + (verified.selectedThinking || 'none'));
        }
        console.log('[GEMINI WEB] Mode ready: ' + chosenName + ' + ' + level +
            (modelFallback || thinkingFallback ? ' (fallback)' : ''));
        return {
            mode: target.mode, model: chosenName, requestedModel: target.modelName,
            modelFallback, thinkingLevel: level, requestedThinkingLevel: target.thinkingLevel,
            thinkingFallback, extended: level === 'high'
        };
    } finally {
        await closeMenu().catch(() => {});
    }
}

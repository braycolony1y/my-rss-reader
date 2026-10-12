// Gemini Web model + thinking-level selection. Live DOM: 2026-10-12.
const MODEL_IDS = Object.freeze({
    '3.5-flash-lite': {
        id: 'bard-mode-option-8c46e95b1a07cecc',
        name: '3.5 Flash-Lite'
    },
    '3.8': {
        id: 'bard-mode-option-56fdd199312815e2',
        name: '3.8 Flash'
    },
    '3.1-pro': {
        id: 'bard-mode-option-e6fa609c3fa255c0',
        name: '3.1 Pro'
    }
});

export function resolveGeminiWebMode(requestedMode = '3.8') {
    const input = String(requestedMode || '3.8').toLowerCase().trim();
    const match = input.match(/^(3\.5-flash-lite|3\.8|3\.1-pro)(?:-(low|medium|high|think))?$/);
    const base = match?.[1] || '3.8';
    const suffix = match?.[2] || 'low';
    const level = suffix === 'think' ? 'high' : suffix;
    const model = MODEL_IDS[base];
    return {
        mode: match ? input : '3.8',
        modelId: model.id,
        modelName: model.name,
        thinkingLevel: level
    };
}

const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};

// The callback is serialized into the actual Gemini browser page by page.evaluate().
export async function readGeminiWebModeState(page) {
    return page.evaluate(() => {
        const menu = document.querySelector('[data-test-id="gem-mode-menu"]');
        const style = menu && getComputedStyle(menu);
        const rect = menu?.getBoundingClientRect();
        if (!menu || style.display === 'none' || style.visibility === 'hidden' ||
            !rect.width || !rect.height) {
            return { open: false, models: [], thinking: [],
                selectedModelId: null, selectedThinking: null };
        }

        const label = element => String(element?.innerText || element?.textContent || '')
            .replace(/\s+/g, ' ').trim();
        const selected = element => !!element && (
            element.classList.contains('selected') ||
            element.getAttribute('aria-selected') === 'true' ||
            element.getAttribute('aria-checked') === 'true' ||
            element.getAttribute('aria-pressed') === 'true' ||
            !!element.querySelector('[aria-label="Selected"]')
        );
        const disabled = element => element.getAttribute('aria-disabled') === 'true' ||
            element.hasAttribute('disabled');
        const models = [...menu.querySelectorAll('[data-test-id^="bard-mode-option-"]')]
            .map(element => ({
                id: element.getAttribute('data-test-id'),
                name: label(element), selected: selected(element),
                disabled: disabled(element)
            }));
        const thinking = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
            .map(element => {
                const name = label(element);
                const match = name.match(/^(Low|Medium|High)\b/i);
                if (!match) return null;
                return {
                    level: match[1].toLowerCase(),
                    label: name,
                    selected: selected(element),
                    disabled: disabled(element)
                };
            }).filter(Boolean);
        return {
            open: true, models, thinking,
            selectedModelId: models.find(item => item.selected)?.id || null,
            selectedThinking: thinking.find(item => item.selected)?.level || null
        };
    });
}

async function clickMenuOption(page, choice) {
    return page.evaluate(({ id, level }) => {
        const menu = document.querySelector('[data-test-id="gem-mode-menu"]');
        if (!menu) return false;
        let option;
        if (id) {
            option = [...menu.querySelectorAll('[data-test-id^="bard-mode-option-"]')]
                .find(element => element.getAttribute('data-test-id') === id);
        } else {
            option = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
                .find(element => new RegExp(`^${level}\\b`, 'i').test(
                    String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
                ));
        }
        if (!option || option.getAttribute('aria-disabled') === 'true' ||
            option.hasAttribute('disabled')) return false;
        option.click();
        return true;
    }, choice);
}

async function waitForSelection({ page, openMenu, sleep, match, code, message }) {
    const deadline = Date.now() + 8000;
    let state;
    while (Date.now() < deadline) {
        await openMenu();
        state = await readGeminiWebModeState(page);
        if (match(state)) return state;
        await sleep(200);
    }
    throw fail(code, `${message}; last selected model=${state?.selectedModelId || 'none'}, thinking=${state?.selectedThinking || 'none'}`);
}

export async function selectGeminiWebMode(page, requestedMode, { openMenu, closeMenu, sleep }) {
    const target = resolveGeminiWebMode(requestedMode);
    try {
        await openMenu();
        let state = await readGeminiWebModeState(page);
        const model = state.models.find(item => item.id === target.modelId);
        if (!model || model.disabled) {
            throw fail('GEMINI_WEB_MODEL_NOT_FOUND',
                `${target.modelName} is missing or disabled in Gemini Web`);
        }
        if (state.selectedModelId !== target.modelId) {
            if (!await clickMenuOption(page, { id: target.modelId })) {
                throw fail('GEMINI_WEB_MODEL_SELECT_FAILED',
                    `Could not click ${target.modelName}`);
            }
            state = await waitForSelection({ page, openMenu, sleep,
                match: value => value.selectedModelId === target.modelId,
                code: 'GEMINI_WEB_MODEL_NOT_CONFIRMED',
                message: `Could not verify ${target.modelName}` });
        }

        // Re-read after model change; Gemini retains the prior thinking level.
        await openMenu();
        state = await readGeminiWebModeState(page);
        const thinking = state.thinking.find(item => item.level === target.thinkingLevel);
        if (!thinking || thinking.disabled) {
            throw fail('GEMINI_WEB_THINKING_LEVEL_NOT_FOUND',
                `Gemini Web does not offer ${target.thinkingLevel} thinking for ${target.modelName}`);
        }
        if (state.selectedThinking !== target.thinkingLevel) {
            if (!await clickMenuOption(page, { level: target.thinkingLevel })) {
                throw fail('GEMINI_WEB_THINKING_SELECT_FAILED',
                    `Could not click ${target.thinkingLevel} thinking`);
            }
            await waitForSelection({ page, openMenu, sleep,
                match: value => value.selectedModelId === target.modelId &&
                    value.selectedThinking === target.thinkingLevel,
                code: 'GEMINI_WEB_THINKING_NOT_CONFIRMED',
                message: `Could not verify ${target.thinkingLevel} thinking` });
        }

        await openMenu();
        const verified = await readGeminiWebModeState(page);
        if (verified.selectedModelId !== target.modelId ||
            verified.selectedThinking !== target.thinkingLevel) {
            throw fail('GEMINI_WEB_MODEL_NOT_CONFIRMED',
                `Expected ${target.modelName}/${target.thinkingLevel}; got ${verified.selectedModelId || 'none'}/${verified.selectedThinking || 'none'}`);
        }
        console.log(`[GEMINI WEB] Mode ready: ${target.modelName} + ${target.thinkingLevel}`);
        return {
            mode: target.mode, model: target.modelName,
            thinkingLevel: target.thinkingLevel,
            // Compatibility for any callers expecting the old boolean.
            extended: target.thinkingLevel === 'high'
        };
    } finally {
        await closeMenu().catch(() => {});
    }
}

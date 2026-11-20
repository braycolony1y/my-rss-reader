// Fresh normal chat confirmation for Gemini Web.
//
// A page that is already an empty chat on the canonical /app route needs no
// "New chat" click (the control is often hidden when the sidebar is collapsed
// in a freshly launched window). When a click is needed but impossible, the
// fallback is navigating to the base /u/N/app URL of the same account. Every
// outcome is re-verified from the live DOM; failure stays fail-closed.

// Runs inside the page. Must stay self-contained.
export function readGeminiFreshChatDom() {
    const visible = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
            rect.width > 0 && rect.height > 0;
    };
    const editors = [...document.querySelectorAll(
        'rich-textarea .ql-editor,.ql-editor[contenteditable="true"],textarea,[contenteditable="true"]'
    )].filter(visible);
    const editor = editors[0] || null;
    const editorText = editor
        ? String('value' in editor && editor.tagName === 'TEXTAREA' ? editor.value : editor.textContent || '').trim()
        : '';
    return {
        url: location.href,
        pathname: location.pathname,
        editorFound: Boolean(editor),
        editorEmpty: Boolean(editor) && editorText === '',
        hasTurns: Boolean(document.querySelector(
            'model-response,[data-message-author-role],user-query,.conversation-container'
        ))
    };
}

export function isFreshNormalChatState(state) {
    return Boolean(
        state &&
        /^(\/u\/\d+)?\/app\/?$/.test(state.pathname || '') &&
        state.editorFound && state.editorEmpty &&
        !state.hasTurns && !state.enabled
    );
}

export function geminiHomeUrl(currentUrl, configuredUrl) {
    const configured = new URL(configuredUrl);
    let account = configured.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1];
    try {
        const current = new URL(currentUrl);
        if (current.origin === configured.origin) {
            account = current.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1] ?? account;
        }
    } catch { /* keep configured account */ }
    return `${configured.origin}${account === undefined ? '' : `/u/${account}`}/app`;
}

export async function confirmFreshNormalChat(page, {
    readState, clickNewChat, goHome, sleep, providerError,
    settleMs = 1500, clickMs = 3000, confirmMs = 10000
}) {
    const waitFresh = async timeoutMs => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const state = await readState(page).catch(() => null);
            if (isFreshNormalChatState(state)) return state;
            if (Date.now() >= deadline) return null;
            await sleep(100);
        }
    };

    // Already a blank normal chat: confirmed without touching any control.
    const ready = await waitFresh(settleMs);
    if (ready) return ready;

    if (await clickNewChat(page, clickMs)) {
        const fresh = await waitFresh(confirmMs);
        if (fresh) return fresh;
    }

    // New chat unavailable or ineffective: open the same account's base URL.
    if (goHome) {
        await goHome(page);
        const fresh = await waitFresh(confirmMs);
        if (fresh) return fresh;
    }

    return providerError(
        page,
        'Gemini could not reach a confirmed fresh normal chat using New chat',
        'GEMINI_WEB_NEW_CHAT_FAILED'
    );
}

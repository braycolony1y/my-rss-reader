import { readGeminiWebModeState, selectGeminiWebMode } from './gemini-web-mode.js';
import { closeOwnedSlotPage } from '../browser/slot-lifecycle.js';
import { summarizeGeminiSlots } from '../browser/resource-state.js';
export const getGeminiWebResourceState = () => summarizeGeminiSlots(slots);
const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

export const GEMINI_WEB_URL =
    process.env.GEMINI_WEB_URL ||
    'https://gemini.google.com/u/1/app';

export const GEMINI_WEB_MODEL = '3.8 Flash';

/*
 * Gemini Web has no provider-local concurrency limit.
 *
 * The global AI scheduler is the sole owner of concurrency.
 * Browser slots below are created elastically only after work
 * has already been authorized by the global scheduler.
 */

const GEMINI_WEB_PROFILE =
    process.env.GEMINI_WEB_PROFILE ||
    process.env.OPENCLI_BROWSER_PROFILE ||
    process.env.OPENCLI_PROFILE ||
    undefined;

const GEMINI_WEB_COOLDOWN_MS = Math.max(
    5000,
    Number(process.env.GEMINI_WEB_COOLDOWN_MS) || 30000
);

const GEMINI_WEB_1095_COOLDOWN_MS =
    Math.max(
        60000,
        Number(
            process.env
                .GEMINI_WEB_1095_COOLDOWN_MS
        ) || 60000
    );

const isGeminiWeb1095Error = error => {
    const diagnostic = [
        error?.code,
        error?.message,
        error?.rawResponse,
        error?.responseText,
        error?.details
    ]
        .filter(Boolean)
        .map(String)
        .join(' ');

    return (
        Number(error?.code) === 1095 ||
        /\b1095\b/.test(diagnostic)
    );
};


/*
 * GEMINI_WEB_PERSISTENT_REUSE_V1
 *
 * Keep Gemini Web tabs alive for reuse by default.
 *
 * The global AI scheduler owns concurrency. Browser slots remain elastic:
 * reuse any idle healthy slot first; if every slot is busy, acquireSlot()
 * may create another physical tab for globally-authorized work.
 *
 * Set GEMINI_WEB_IDLE_CLOSE_MS to a positive value only when an explicit
 * idle-tab cleanup policy is desired. 0/unset means persistent reuse.
 */
const GEMINI_WEB_IDLE_CLOSE_MS = (() => {
    const raw =
        process.env.GEMINI_WEB_IDLE_CLOSE_MS;

    if (
        raw === undefined ||
        raw === null ||
        String(raw).trim() === ''
    ) {
        return 0;
    }

    const parsed =
        Number(raw);

    if (
        !Number.isFinite(parsed) ||
        parsed <= 0
    ) {
        return 0;
    }

    return Math.max(
        5000,
        parsed
    );
})();

const slots = [];
let nextSlotId = 1;


let retryAt = 0;
let browserModulesPromise = null;

// GEMINI_WEB_SHORT_COOLDOWN_V1
export function geminiWebConfigured() {
    return (
        process.env.GEMINI_WEB_ENABLED !==
        'false'
    );
}

export function getGeminiWebCooldownState() {
    const until =
        Math.max(
            0,
            Number(
                retryAt
            ) || 0
        );

    return {
        enabled:
            geminiWebConfigured(),
        retryAt:
            until,
        remainingMs:
            Math.max(
                0,
                until -
                    Date.now()
            )
    };
}

export function geminiWebAvailable() {
    const state =
        getGeminiWebCooldownState();

    return (
        state.enabled &&
        state.remainingMs <= 0
    );
}

async function browserModules() {
    if (!browserModulesPromise) {
        browserModulesPromise = Promise.all([
            import(
                '../browser/opencli-page.js'
            ),
            import(
                '../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js'
            )
        ]).then(([
            { Page },
            { setDaemonCommandTimeoutSeconds }
        ]) => {
            setDaemonCommandTimeoutSeconds(35);
            return { Page };
        });
    }

    return browserModulesPromise;
}

function clearIdleClose(slot) {
    if (!slot.idleTimer) return;

    clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
}


async function closeSlotPage(slot, reason = 'cleanup') {
    return closeOwnedSlotPage(slot, reason, clearIdleClose);
}

function scheduleIdleClose(slot) {
    clearIdleClose(slot);

    /*
     * Persistent reuse is the default. releaseSlot() therefore only marks
     * the slot idle; it does not close the physical Gemini tab.
     */
    if (
        GEMINI_WEB_IDLE_CLOSE_MS <= 0
    ) {
        return;
    }

    if (
        slot.busy ||
        !slot.page
    ) {
        return;
    }

    const pageAtSchedule =
        slot.page;

    slot.idleTimer =
        setTimeout(
            async () => {
                slot.idleTimer = null;

                if (
                    slot.busy ||
                    !slot.page ||
                    slot.page !== pageAtSchedule
                ) {
                    return;
                }

                const idleFor =
                    Date.now() -
                    slot.lastUsedAt;

                if (
                    idleFor <
                    GEMINI_WEB_IDLE_CLOSE_MS
                ) {
                    scheduleIdleClose(slot);
                    return;
                }

                await closeSlotPage(
                    slot,
                    'idle timeout'
                );
            },
            GEMINI_WEB_IDLE_CLOSE_MS
        );

    /*
     * Don't keep standalone Node tests alive just because
     * this maintenance timer exists.
     */
    slot.idleTimer.unref?.();
}



// ============================================================
// GEMINI WEB PROVIDER-LOCAL BROWSER SLOTS
//
// These are physical browser resources only.
// They contain NO priority/read-mode/concurrency policy.
// The global scheduler authorizes work before provider routing.
// Slots grow elastically to match globally authorized work and
// are reused after release. Idle browser pages remain open by default so
// the same physical tabs can serve later jobs; optional timed cleanup is
// available only when GEMINI_WEB_IDLE_CLOSE_MS is explicitly positive.
// ============================================================

function acquireSlot() {
    /*
     * Reuse an existing idle physical browser slot first.
     *
     * If every existing slot is busy, create another one.
     * There is intentionally NO Gemini-Web-local maximum here:
     * the global AI scheduler already decided that this request
     * is allowed to run.
     */
    let slot =
        slots.find(
            candidate =>
                !candidate.busy
        );

    if (!slot) {
        slot = {
            id:
                nextSlotId++,

            busy:
                false,

            page:
                null,

            idleTimer:
                null,

            lastUsedAt:
                0
        };

        slots.push(
            slot
        );

        console.log(
            `[GEMINI WEB] Created elastic browser slot ${slot.id} ` +
            `(physical slots: ${slots.length})`
        );
    }

    clearIdleClose(slot);

    slot.busy =
        true;

    return slot;
}


function releaseSlot(slot) {
    if (!slot) return;

    slot.busy = false;
    slot.lastUsedAt =
        Date.now();

    scheduleIdleClose(slot);
}


function isGeminiStalePageIdentityError(error) {
    const message =
        error instanceof Error
            ? error.message
            : String(error || '');

    return (
        /stale page identity/i.test(message) ||
        /^Page not found:\s*\S+(?:\s+[—-].*)?$/i.test(message.trim())
    );
}


function installGeminiStalePageRecovery(slot, page) {
    // GEMINI_WEB_STALE_PAGE_LEASE_REBIND_V1
    //
    // OpenCLI Page.goto() already drops a stale cached targetId and resolves
    // through the persistent session lease. Page.evaluate() does not.
    //
    // Gemini Web heavily reuses evaluate() on persistent slot tabs, so recover
    // only the stale-target case transparently:
    //   stale targetId -> clear cached targetId -> retry SAME evaluate once
    // through the SAME slot/session lease.
    //
    // No reload, no new tab, no new chat. If lease rebinding also fails, the
    // error propagates; the next job recovers the conversation in this slot.
    if (!page || page.__geminiStalePageRecoveryInstalled) {
        return page;
    }

    const originalEvaluate =
        page.evaluate.bind(page);

    page.evaluate =
        async (...args) => {
            try {
                return await originalEvaluate(...args);
            } catch (error) {
                if (!isGeminiStalePageIdentityError(error)) {
                    throw error;
                }

                const stalePage =
                    page.getActivePage?.();

                console.warn(
                    `[GEMINI WEB] Slot ${slot.id}: stale page identity`
                    + `${stalePage ? ` (${stalePage})` : ''}; `
                    + `rebinding existing slot lease without reload/new tab`
                );

                page.setActivePage?.(undefined);

                try {
                    const result =
                        await originalEvaluate(...args);

                    console.log(
                        `[GEMINI WEB] Slot ${slot.id}: rebound existing Gemini tab `
                        + `through persistent session lease; evaluate retry succeeded`
                    );

                    return result;
                } catch (retryError) {
                    console.warn(
                        `[GEMINI WEB] Slot ${slot.id}: stale-page lease rebind failed: `
                        + `${retryError?.message || retryError}; `
                        + `falling back to existing slot cleanup`
                    );

                    throw retryError;
                }
            }
        };

    Object.defineProperty(
        page,
        '__geminiStalePageRecoveryInstalled',
        {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false
        }
    );

    return page;
}


async function getPage(slot) {
    if (slot.page) return slot.page;

    const { Page } = await browserModules();

    slot.page = installGeminiStalePageRecovery(
        slot,
        new Page(
            `rss-gemini-web-${slot.id}`,
            -1,
            undefined,
            'background',
            'browser',
            'persistent',
            GEMINI_WEB_PROFILE
        )
    );

    return slot.page;
}

async function collectDiagnostics(page) {
    return page.evaluate(() => {
        const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const label = element =>
            [
                element.innerText,
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.getAttribute('data-tooltip')
            ]
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

        return {
            url: location.href,
            title: document.title,
            buttons: [
                ...document.querySelectorAll(
                    'button,[role="button"],[role="menuitem"],[role="option"]'
                )
            ]
                .filter(visible)
                .map(label)
                .filter(Boolean)
                .slice(0, 50),

            inputs: [
                ...document.querySelectorAll(
                    'textarea,[contenteditable="true"]'
                )
            ]
                .filter(visible)
                .map(element => ({
                    tag: element.tagName,
                    role: element.getAttribute('role'),
                    aria: element.getAttribute('aria-label'),
                    placeholder:
                        element.getAttribute('placeholder'),
                    className:
                        String(element.className || '')
                            .slice(0, 120)
                }))
                .slice(0, 20)
        };
    });
}

async function providerError(
    page,
    message,
    code
) {
    const error = new Error(message);
    error.code = code;

    try {
        error.ui = await collectDiagnostics(page);
    } catch {
        // Diagnostics must never hide the original error.
    }

    throw error;
}

async function waitForGeminiPage(
    page,
    timeoutMs = 20000
) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const state = await page.evaluate(() => ({
            url: location.href,
            readyState: document.readyState,
            title: document.title || '',
            bodyLength:
                (document.body?.innerText || '').length
        })).catch(() => null);

        if (state) {
            if (
                /accounts\.google\.com/i.test(state.url)
            ) {
                return providerError(
                    page,
                    'Gemini Web requires the Google account to be signed in',
                    'GEMINI_WEB_LOGIN_REQUIRED'
                );
            }

            if (
                state.readyState !== 'loading' &&
                state.bodyLength > 100
            ) {
                return state;
            }
        }

        await sleep(300);
    }

    return providerError(
        page,
        'Gemini Web did not become ready',
        'GEMINI_WEB_PAGE_TIMEOUT'
    );
}

async function temporaryChatState(page) {
    return page.evaluate(() => {
        const visible = element => {
            if (!element) return false;

            const style =
                getComputedStyle(element);

            const rect =
                element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const freshRoute =
            /\/app\/?$/.test(
                location.pathname
            );

        /*
         * Confirmed by the live Gemini DOM:
         *
         * Once a Temporary Chat is active Gemini may remove
         * the toolbar Temporary Chat button completely.
         *
         * The conversation itself then exposes its state.
         */
        const activeTemporaryDom =
            Boolean(
                document.querySelector(
                    'chat-window.is-temporary-chat'
                ) ||
                document.querySelector(
                    '.chat-history.temporary-chat'
                ) ||
                document.querySelector(
                    'infinite-scroller.temporary-chat'
                )
            );

        const temporaryButton = [
            ...document.querySelectorAll(
                'button[aria-label],[role="button"][aria-label]'
            )
        ]
            .filter(visible)
            .find(element =>
                /^temporary chat$/i.test(
                    String(
                        element.getAttribute(
                            'aria-label'
                        ) || ''
                    )
                        .replace(/\s+/g, ' ')
                        .trim()
                )
            );

        const icon =
            temporaryButton?.querySelector('mat-icon');

        const iconName =
            String(
                icon?.getAttribute(
                    'data-mat-icon-name'
                ) ||
                icon?.getAttribute(
                    'fonticon'
                ) ||
                icon?.textContent ||
                ''
            ).replace(/\s+/g, ' ').trim();

        const toolbarEnabled =
            iconName === 'close';

        const canEnable =
            iconName ===
            'gemini_chat_temp';

        const enabled =
            activeTemporaryDom ||
            toolbarEnabled;

        return {
            found:
                Boolean(
                    temporaryButton ||
                    activeTemporaryDom
                ),

            knownState:
                enabled ||
                canEnable,

            enabled,

            canEnable:
                !enabled &&
                canEnable,

            activeTemporaryDom,

            buttonFound:
                Boolean(
                    temporaryButton
                ),

            iconName,

            ariaLabel:
                String(
                    temporaryButton
                        ?.getAttribute(
                            'aria-label'
                        ) ||
                    ''
                ),

            freshRoute,
            conversationEmpty: !document.querySelector('model-response,[data-message-author-role="model"],user-query'),

            url:
                location.href
        };
    });
}


async function waitForTemporaryChatControl(
    page,
    timeoutMs = 15000
) {
    const deadline =
        Date.now() + timeoutMs;

    let lastState = null;

    while (Date.now() < deadline) {
        lastState =
            await temporaryChatState(
                page
            );

        if (
            lastState?.found &&
            lastState?.knownState
        ) {
            return lastState;
        }

        await sleep(200);
    }

    return null;
}


async function ensureTemporaryChat(page) {
    let state = await temporaryChatState(page);

    if (state.enabled) {
        return;
    }

    if (!state.canEnable) {
        return providerError(
            page,
            'Temporary Chat control was not found',
            'GEMINI_WEB_TEMP_CHAT_NOT_FOUND'
        );
    }

    const clicked = await page.evaluate(() => {
        const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const button = [
            ...document.querySelectorAll(
                'button,[role="button"]'
            )
        ]
            .filter(visible)
            .find(element =>
                /^temporary chat$/i.test(
                    (
                        element.getAttribute('aria-label') ||
                        element.innerText ||
                        ''
                    ).trim()
                )
            );

        if (!button) return false;

        button.click();
        return true;
    });

    if (!clicked) {
        return providerError(
            page,
            'Temporary Chat could not be enabled',
            'GEMINI_WEB_TEMP_CHAT_CLICK_FAILED'
        );
    }

    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
        await sleep(250);

        state = await temporaryChatState(page);

        if (state.enabled) {
            return;
        }
    }

    return providerError(
        page,
        `Temporary Chat could not be confirmed as enabled (icon: ${state.iconName || 'unknown'})`,
        'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED'
    );
}

async function clickTemporaryChatToggle(page) {
    return page.evaluate(() => {
        const visible = element => {
            if (!element) return false;

            const style =
                getComputedStyle(element);

            const rect =
                element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const button = [
            ...document.querySelectorAll(
                'button[aria-label],[role="button"][aria-label]'
            )
        ]
            .filter(visible)
            .find(element =>
                /^temporary chat$/i.test(
                    String(
                        element.getAttribute(
                            'aria-label'
                        ) || ''
                    )
                        .replace(/\s+/g, ' ')
                        .trim()
                )
            );

        if (!button) {
            return false;
        }

        button.click();

        return true;
    });
}


async function waitForTemporaryChatState(
    page,
    expectedEnabled,
    timeoutMs = 8000
) {
    const deadline =
        Date.now() + timeoutMs;

    let state = null;

    while (Date.now() < deadline) {
        state =
            await temporaryChatState(
                page
            );

        if (
            state?.found &&
            state?.knownState &&
            state.enabled === expectedEnabled
        ) {
            return state;
        }

        await sleep(200);
    }

    return providerError(
        page,
        expectedEnabled
            ? 'Temporary Chat could not be confirmed ON'
            : 'Temporary Chat could not be confirmed OFF',
        expectedEnabled
            ? 'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED'
            : 'GEMINI_WEB_TEMP_CHAT_RESET_FAILED'
    );
}


async function clickGeminiNewChatControl(page, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let sidebarOpened = false;
    while (Date.now() < deadline) {
        const result = await page.evaluate(() => {
            const visible = element => {
                if (!element) return false;
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' &&
                    rect.width > 0 && rect.height > 0;
            };
            const name = element => String(
                element.getAttribute('aria-label') || ''
            ).replace(/\s+/g, ' ').trim();
            const links = [...document.querySelectorAll(
                'a[aria-label="New chat"],button[aria-label="New chat"],[role="button"][aria-label="New chat"]'
            )].filter(visible);
            const preferred = links.find(element => {
                const href = element.getAttribute('href');
                if (!href) return false;
                try {
                    const url = new URL(href, location.href);
                    return url.origin === location.origin &&
                        /\/app\/?$/.test(url.pathname);
                } catch { return false; }
            });
            // Never click the sparkle/home link at "/" as a substitute.
            if (preferred) {
                preferred.click();
                return { clicked: true, href: preferred.getAttribute('href') };
            }
            const menu = [...document.querySelectorAll('button')].find(element =>
                visible(element) && (
                    /^main menu$/i.test(name(element)) ||
                    [...element.querySelectorAll('mat-icon')].some(icon =>
                        /^(menu|menu_open)$/.test(String(
                            icon.getAttribute('fonticon') ||
                            icon.getAttribute('data-mat-icon-name') ||
                            icon.textContent || ''
                        ).trim())
                    )
                )
            );
            if (menu) {
                menu.click();
                return { openedSidebar: true };
            }
            return { missing: true };
        });
        if (result.clicked) return true;
        if (result.openedSidebar) sidebarOpened = true;
        await sleep(sidebarOpened ? 250 : 200);
    }
    return false;
}

async function waitForFreshNormalChat(
    page,
    timeoutMs = 12000
) {
    const deadline =
        Date.now() + timeoutMs;

    let state = null;

    while (Date.now() < deadline) {
        state =
            await temporaryChatState(
                page
            );

        /*
         * Fresh normal Gemini chat:
         *
         * - canonical /app route
         * - NOT currently Temporary Chat
         * - Temporary Chat button is available with
         *   gemini_chat_temp icon.
         */
        if (
            state?.freshRoute &&
            state?.conversationEmpty &&
            !state?.enabled &&
            state?.canEnable
        ) {
            return state;
        }

        await sleep(200);
    }

    return null;
}


async function returnToGeminiChatHome(page) {
    // Verified 2026-10-16: real New chat control works with both collapsed
    // and expanded sidebar, including reactivation from Temporary Chat.
    // Avoid Ctrl+Shift+O and reload-based resets for routine jobs.
    for (let attempt = 1; attempt <= 2; attempt++) {
        const clicked = await clickGeminiNewChatControl(page, 5000);
        if (clicked) {
            const fresh = await waitForFreshNormalChat(page, 10000);
            if (fresh) return fresh;
        }
        console.warn('[GEMINI WEB] New chat UI confirmation failed, attempt ' + attempt);
    }
    return providerError(
        page,
        'Gemini could not reach a confirmed fresh normal chat using New chat',
        'GEMINI_WEB_NEW_CHAT_FAILED'
    );
}

async function resetFreshTemporaryChat(page) {
    let state =
        await waitForFreshNormalChat(
            page,
            3000
        );

    /*
     * If we somehow reached this function while still inside
     * an old Temporary Chat or another conversation, start a
     * real new conversation first.
     */
    if (!state) {
        console.warn(
            '[GEMINI WEB] Fresh normal chat not confirmed before Temporary Chat; resetting conversation'
        );

        await returnToGeminiChatHome(
            page
        );

        state =
            await waitForFreshNormalChat(
                page,
                10000
            );
    }

    if (!state) {
        return providerError(
            page,
            'Fresh normal Gemini chat could not be confirmed before enabling Temporary Chat',
            'GEMINI_WEB_FRESH_CHAT_NOT_CONFIRMED'
        );
    }

    const clickedOn =
        await clickTemporaryChatToggle(
            page
        );

    if (!clickedOn) {
        return providerError(
            page,
            'Could not start a fresh Temporary Chat',
            'GEMINI_WEB_TEMP_CHAT_CLICK_FAILED'
        );
    }

    await waitForTemporaryChatState(page, true, 10000);
    // Fail closed: require BOTH independently observed live indicators.
    const verified = await temporaryChatState(page);
    if (!verified.activeTemporaryDom || verified.iconName !== 'close') {
        return providerError(page,
            'Temporary Chat activation requires both active chat DOM and close icon',
            'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED');
    }
}


async function waitForModePicker(
    page,
    timeoutMs = 10000
) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const found = await page.evaluate(() => {
            const element = document.querySelector(
                '[data-test-id="bard-mode-menu-button"]'
            );

            if (!element) return false;

            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        }).catch(() => false);

        if (found) return;

        await sleep(250);
    }

    return providerError(
        page,
        'Gemini Web mode picker did not appear',
        'GEMINI_WEB_MODE_PICKER_NOT_FOUND'
    );
}


async function openModelMenu(page) {
    await waitForModePicker(page);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const state = await readGeminiWebModeState(page);
        if (state.open) return state;
        await page.evaluate(() => {
            const button = document.querySelector('[data-test-id="bard-mode-menu-button"]');
            if (button && button.getAttribute('aria-expanded') !== 'true') {
                button.click();
            }
        });
        await sleep(150);
    }
    return providerError(page, 'Gemini Web model menu did not open',
        'GEMINI_WEB_MODEL_MENU_TIMEOUT');
}

async function closeModelMenu(page) {
    await page.evaluate(() => {
        const button = document.querySelector('[data-test-id="bard-mode-menu-button"]');
        if (button?.getAttribute('aria-expanded') === 'true') button.click();
    }).catch(() => {});
    await sleep(150);
}

async function ensureModel(page, requestedMode = '3.8') {
    try {
        return await selectGeminiWebMode(page, requestedMode, {
            openMenu: () => openModelMenu(page),
            closeMenu: () => closeModelMenu(page),
            sleep
        });
    } catch (error) {
        if (error?.code?.startsWith('GEMINI_WEB_') && !error.ui) {
            return providerError(page, error.message, error.code);
        }
        throw error;
    }
}


async function setPrompt(page, text) {
    const result = await page.evaluate(promptText => {
        const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const candidates = [
            ...document.querySelectorAll(
                'textarea,[contenteditable="true"]'
            )
        ].filter(element =>
            visible(element) &&
            !element.disabled
        );

        const score = element => {
            const description = [
                element.getAttribute('aria-label'),
                element.getAttribute('placeholder'),
                element.getAttribute('role'),
                element.className
            ]
                .filter(Boolean)
                .join(' ');

            let value = 0;

            if (/prompt|message|ask gemini/i.test(description)) {
                value += 20;
            }

            if (element.getAttribute('role') === 'textbox') {
                value += 10;
            }

            if (/ql-editor/i.test(String(element.className))) {
                value += 8;
            }

            if (element.isContentEditable) {
                value += 4;
            }

            return value;
        };

        candidates.sort(
            (a, b) =>
                score(b) - score(a)
        );

        const editor = candidates[0];

        if (!editor) {
            return {
                ok: false
            };
        }

        editor.focus();

        if (
            editor instanceof HTMLTextAreaElement ||
            editor instanceof HTMLInputElement
        ) {
            const prototype =
                editor instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;

            const setter =
                Object.getOwnPropertyDescriptor(
                    prototype,
                    'value'
                )?.set;

            if (setter) {
                setter.call(
                    editor,
                    promptText
                );
            } else {
                editor.value =
                    promptText;
            }

            editor.dispatchEvent(
                new Event(
                    'input',
                    {
                        bubbles: true
                    }
                )
            );
        } else {
            try {
                document.execCommand(
                    'selectAll',
                    false,
                    null
                );

                document.execCommand(
                    'insertText',
                    false,
                    promptText
                );
            } catch {
                // Fall through to direct content update.
            }

            if (
                !String(editor.innerText || '')
                    .trim()
            ) {
                editor.textContent =
                    promptText;

                editor.dispatchEvent(
                    new InputEvent(
                        'input',
                        {
                            bubbles: true,
                            inputType:
                                'insertText',
                            data:
                                promptText
                        }
                    )
                );
            }
        }

        return {
            ok: true
        };
    }, text);

    if (!result?.ok) {
        return providerError(
            page,
            'Gemini Web prompt editor was not found',
            'GEMINI_WEB_PROMPT_NOT_FOUND'
        );
    }
}

async function submitPrompt(page) {
    const deadline = Date.now() + 6000;

    while (Date.now() < deadline) {
        const submitted = await page.evaluate(() => {
            const visible = element => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0
                );
            };

            const label = element =>
                [
                    element.innerText,
                    element.getAttribute('aria-label'),
                    element.getAttribute('title'),
                    element.getAttribute('data-tooltip')
                ]
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();

            const buttons = [
                ...document.querySelectorAll('button')
            ].filter(element =>
                visible(element) &&
                !element.disabled
            );

            const send = buttons.find(element =>
                /send message|^send$/i.test(
                    label(element)
                )
            );

            if (send) {
                send.click();
                return true;
            }

            return false;
        });

        if (submitted) return;

        await sleep(150);
    }

    return providerError(
        page,
        'Gemini Web send button was not available',
        'GEMINI_WEB_SEND_NOT_FOUND'
    );
}

async function responseState(page) {
    return page.evaluate(() => {
        const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const modelResponses = [
            ...document.querySelectorAll(
                'model-response'
            )
        ].filter(visible);

        let text = '';

        if (modelResponses.length) {
            const response = modelResponses[modelResponses.length - 1];
            // Read the answer body rather than action buttons and other
            // changing chrome in the model-response wrapper.
            const body = response.querySelector('.model-response-text') || response.querySelector('.response-container-content');
            text = (body || response).innerText || '';
        }

        if (!text.trim()) {
            const alternatives = [
                ...document.querySelectorAll(
                    '[data-message-author-role="model"],.model-response-text,.response-container-content'
                )
            ].filter(visible);

            if (alternatives.length) {
                text =
                    alternatives[
                        alternatives.length - 1
                    ].innerText || '';
            }
        }

        const controls = [
            ...document.querySelectorAll(
                'button,[role="button"]'
            )
        ].filter(visible);

        const generating =
            controls.some(element => {
                const label = [
                    element.innerText,
                    element.getAttribute('aria-label'),
                    element.getAttribute('title')
                ]
                    .filter(Boolean)
                    .join(' ');

                return /stop response|stop generating|cancel response/i
                    .test(label);
            });

        const alerts = [
            ...document.querySelectorAll(
                '[role="alert"],[aria-live="assertive"],.error-message'
            )
        ]
            .filter(visible)
            .map(element =>
                String(element.innerText || '')
                    .replace(/\s+/g, ' ')
                    .trim()
            )
            .filter(Boolean)
            .join(' ');

        /*
         * GEMINI_WEB_RESPONSE_DOM_DEBUG
         *
         * Diagnostic only. Do not use these fields for completion
         * decisions. They let us prove whether responseState() is
         * following the same DOM node that Gemini is actually updating.
         */
        const debugCandidates = [
            ...document.querySelectorAll(
                'model-response,[data-message-author-role="model"],.model-response-text,.response-container-content'
            )
        ]
            .filter(visible)
            .map((element, index) => {
                const value =
                    String(
                        element.innerText ||
                        ''
                    ).trim();

                return {
                    index,
                    tag:
                        String(
                            element.tagName ||
                            ''
                        ).toLowerCase(),
                    className:
                        String(
                            element.className ||
                            ''
                        ).slice(0, 120),
                    role:
                        element.getAttribute(
                            'data-message-author-role'
                        ) || null,
                    length:
                        value.length,
                    tail:
                        value.slice(-120)
                };
            })
            .slice(-8);

        const debugControls =
            controls
                .map(element => {
                    const label = [
                        element.innerText,
                        element.getAttribute(
                            'aria-label'
                        ),
                        element.getAttribute(
                            'title'
                        )
                    ]
                        .filter(Boolean)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    return {
                        label:
                            label.slice(
                                0,
                                160
                            ),
                        disabled:
                            Boolean(
                                element.disabled
                            ),
                        ariaBusy:
                            element.getAttribute(
                                'aria-busy'
                            )
                    };
                })
                .filter(item =>
                    /stop|cancel|generat|response/i
                        .test(
                            item.label
                        )
                )
                .slice(0, 12);

        /*
         * GEMINI_WEB_RESPONSE_ACTION_COMPLETION_V1
         *
         * Live OpenCLI testing shows Gemini's completed-response
         * action controls appear only after response rendering has
         * finished:
         *
         *   Redo
         *   Copy
         *   Show more options
         *
         * Stop/microphone state is intentionally NOT used as a
         * completion signal.
         */
        const latestModelResponse =
            modelResponses[
                modelResponses.length - 1
            ] || null;

        let responseCompletionControls = {
            redo: false,
            copy: false,
            more: false,
            count: 0,
            ready: false
        };

        if (latestModelResponse) {
            const responseControls = [
                ...latestModelResponse.querySelectorAll(
                    'gem-icon-button,button,[role="button"]'
                )
            ].filter(visible);

            let redo = false;
            let copy = false;
            let more = false;

            for (const element of responseControls) {
                const testId =
                    String(
                        element.getAttribute(
                            'data-test-id'
                        ) || ''
                    );

                const label = [
                    element.getAttribute(
                        'aria-label'
                    ),
                    element.getAttribute(
                        'arialabel'
                    ),
                    element.getAttribute(
                        'title'
                    ),
                    element.getAttribute(
                        'gemtooltip'
                    ),
                    element.innerText
                ]
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (
                    testId ===
                        'regenerate-button' ||
                    /^redo$/i.test(label)
                ) {
                    redo = true;
                }

                if (
                    /^copy(?: response)?$/i.test(
                        label
                    )
                ) {
                    copy = true;
                }

                if (
                    testId ===
                        'more-menu-button' ||
                    /^show more options$/i.test(
                        label
                    ) ||
                    /^more$/i.test(label)
                ) {
                    more = true;
                }
            }

            const count =
                Number(redo) +
                Number(copy) +
                Number(more);

            responseCompletionControls = {
                redo,
                copy,
                more,
                count,

                /*
                 * Copy is our primary completed-response control.
                 * Require either Redo or More as independent
                 * corroboration so one stray button cannot cause
                 * a false completion.
                 */
                ready:
                    copy &&
                    (
                        redo ||
                        more
                    )
            };
        }

        return {
            text: text.trim(),

            /*
             * Kept for diagnostics only.
             * waitForResponse() no longer uses this as completion.
             */
            generating,

            responseFinished:
                responseCompletionControls.ready,

            responseCompletionControls,

            alerts: alerts.slice(0, 1000),
            error1095Visible: /Something went wrong\s*\(\s*1095\s*\)/i.test(
                String(document.body?.innerText || document.body?.textContent || '')
            ),
            debug: {
                candidateCount:
                    debugCandidates.length,
                candidates:
                    debugCandidates,
                controls:
                    debugControls
            }
        };
    });
}

/*
 * GEMINI_WEB_JSON_COMPLETION_RECOVERY
 *
 * Gemini can remove its generating/Stop control before the
 * response DOM has finished settling.
 *
 * For JSON jobs, do not accept text that is obviously cut off.
 */
function geminiWebJsonCompletionState(value) {
  // GEMINI_WEB_STRIP_TRAILING_PROVIDER_TEXT_V1
  //
  // Gemini Web can append UI/provider advisory text after an otherwise
  // complete JSON response, e.g.:
  //
  //   {...valid JSON...}
  //
  //   Election info changes quickly. Verify responses with official sources.
  //
  // If the response begins with a valid complete root JSON object/array,
  // trim everything after that JSON before the existing completion/parser
  // logic runs. Genuinely truncated JSON is left untouched.
  {
    let candidate = String(value ?? '')
      .replace(/^\uFEFF/, '')
      .trim();

    candidate = candidate.replace(/^```(?:json)?\s*/i, '');

    const first = candidate[0];

    if (first === '{' || first === '[') {
      const stack = [];
      let inString = false;
      let escaped = false;
      let rootEnd = -1;

      for (let i = 0; i < candidate.length; i += 1) {
        const ch = candidate[i];

        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }

          if (ch === '\\') {
            escaped = true;
            continue;
          }

          if (ch === '"') {
            inString = false;
          }

          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }

        if (ch === '{' || ch === '[') {
          stack.push(ch);
          continue;
        }

        if (ch === '}' || ch === ']') {
          if (!stack.length) {
            break;
          }

          const opener = stack[stack.length - 1];

          const matches =
            (opener === '{' && ch === '}') ||
            (opener === '[' && ch === ']');

          if (!matches) {
            break;
          }

          stack.pop();

          if (stack.length === 0) {
            rootEnd = i + 1;
            break;
          }
        }
      }

      if (rootEnd > 0) {
        const jsonPrefix = candidate.slice(0, rootEnd);

        try {
          JSON.parse(jsonPrefix);

          // Preserve all existing completion/repair behavior, but make it
          // operate on the actual JSON rather than Gemini Web footer text.
          value = jsonPrefix;
        } catch {
          // Closed-looking but invalid JSON: leave original value untouched
          // so the existing repair logic can deal with it.
        }
      }
    }
  }

    const text =
        cleanResponse(value);

    if (!text) {
        return {
            accepted: false,
            incomplete: true
        };
    }

    try {
        JSON.parse(text);

        return {
            accepted: true,
            incomplete: false
        };
    }
    catch {
        // Existing narrow quote repair gets one chance below.
    }

    /*
     * If the existing quote-only repair can produce valid JSON,
     * the document is complete enough. The normal parse layer
     * will perform and log that repair later.
     */
    const repair =
        repairGeminiWebJsonQuotes(
            text
        );

    if (repair.changed) {
        try {
            JSON.parse(
                repair.text
            );

            return {
                accepted: true,
                incomplete: false
            };
        }
        catch {
            // Continue with conservative structural checks.
        }
    }

    const trimmed =
        text.trim();

    const finalCharacter =
        trimmed[
            trimmed.length - 1
        ] || '';

    /*
     * This catches the failures we observed, for example:
     *
     * {"analysisReview":[{"label":"What changed",
     *
     * A complete top-level JSON object/array cannot end there.
     */
    if (
        finalCharacter !== '}' &&
        finalCharacter !== ']'
    ) {
        return {
            accepted: false,
            incomplete: true
        };
    }

    /*
     * Detect an outer object/array that is still open even when
     * the response happens to end after a complete inner object.
     *
     * If quote state itself is malformed, do NOT invent a repair;
     * hand it back to the existing parser/quote-repair path.
     */
    const stack = [];

    let inString = false;
    let escaped = false;
    let mismatch = false;

    for (const char of trimmed) {
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (
            char === '{' ||
            char === '['
        ) {
            stack.push(
                char
            );

            continue;
        }

        if (
            char === '}' ||
            char === ']'
        ) {
            const expected =
                char === '}'
                    ? '{'
                    : '[';

            if (
                stack[
                    stack.length - 1
                ] !== expected
            ) {
                mismatch = true;
                break;
            }

            stack.pop();
        }
    }

    if (
        !mismatch &&
        !inString &&
        stack.length > 0
    ) {
        return {
            accepted: false,
            incomplete: true
        };
    }

    /*
     * Complete-looking but malformed JSON is NOT treated as
     * truncation. Let the existing strict parser handle it.
     */
    return {
        accepted: false,
        incomplete: false
    };
}


export async function waitForResponse(
    page,
    baseline,
    timeoutMs,
    expectJson = false
) {
    let deadline =
        Date.now() + timeoutMs;

    let lastText = '';
    let lastState = null;
    let stableCount = 0;
    let started = false;

    let incompleteSince = 0;
    let incompleteLogged = false;

    // GEMINI_WEB_RESPONSE_PROGRESS_DEBUG
    // Diagnostic only; has no effect on completion logic.
    const responseDebugStartedAt =
        Date.now();

    let responseDebugLastLogAt = 0;
    let responseDebugLastGenerating = null;
    let responseDebugLastCandidateSignature = '';

    const JSON_COMPLETION_GRACE_MS =
        12000;

    while (Date.now() < deadline) {
        const state =
            await responseState(page);
        lastState = state;

        if (
            expectJson &&
            state?.text &&
            state.text !== baseline
        ) {
            const now =
                Date.now();

            const candidateSignature =
                JSON.stringify(
                    (
                        state.debug
                            ?.candidates ||
                        []
                    ).map(
                        item => [
                            item.tag,
                            item.role,
                            item.length
                        ]
                    )
                );

            const importantChange =
                responseDebugLastGenerating !==
                    state.generating ||
                responseDebugLastCandidateSignature !==
                    candidateSignature;

            if (
                importantChange ||
                now -
                    responseDebugLastLogAt >=
                    2000
            ) {
                console.log(
                    '[GEMINI WEB RESPONSE DEBUG]',
                    JSON.stringify({
                        elapsedMs:
                            now -
                            responseDebugStartedAt,
                        selectedTextLength:
                            state.text.length,
                        selectedTextTail:
                            state.text.slice(
                                -160
                            ),
                        generatingDiagnosticOnly:
                            state.generating,
                        responseFinished:
                            state.responseFinished,
                        responseCompletionControls:
                            state.responseCompletionControls,
                        stableCount,
                        incompleteForMs:
                            incompleteSince
                                ? now -
                                    incompleteSince
                                : 0,
                        candidateCount:
                            state.debug
                                ?.candidateCount ||
                            0,
                        candidates:
                            state.debug
                                ?.candidates ||
                            [],
                        controls:
                            state.debug
                                ?.controls ||
                            []
                    })
                );

                responseDebugLastLogAt =
                    now;

                responseDebugLastGenerating =
                    state.generating;

                responseDebugLastCandidateSignature =
                    candidateSignature;
            }
        }

        /*
         * Gemini can show:
         *   "Something went wrong (1095)"
         *
         * as a snackbar/modal after the prompt was submitted.
         * Detect it on every response poll, even if generation already
         * produced partial text.
         */
        if (state.error1095Visible) {
            const error =
                new Error(
                    'Gemini Web modal error 1095 detected: Something went wrong (1095)'
                );

            error.code =
                'GEMINI_WEB_1095';

            error.status =
                1095;

            throw error;
        }


        if (
            state.text &&
            state.text !== baseline
        ) {
            started = true;

            if (state.text === lastText) {
                stableCount++;
            } else {
                stableCount = 0;
                lastText = state.text;

                /*
                 * New response text arrived. Restart any
                 * incomplete-JSON settling window.
                 */
                incompleteSince = 0;
                incompleteLogged = false;
            }

            // A fresh, complete root JSON document is conclusive even when
            // background-tab rendering leaves Stop/actions stale. Fresh-chat
            // verification and the baseline check exclude a previous response.
            const jsonCompletion = expectJson ? geminiWebJsonCompletionState(state.text) : null;
            if (jsonCompletion?.accepted) {
                return state.text;
            }

            if (
                state.responseFinished &&
                stableCount >= 3
            ) {
                if (!expectJson) {
                    return state.text;
                }

                const completion =
                    geminiWebJsonCompletionState(
                        state.text
                    );

                /*
                 * Valid JSON, or complete JSON requiring only
                 * the existing narrow quote repair.
                 */
                if (completion.accepted) {
                    return state.text;
                }

                /*
                 * Complete-looking but malformed JSON belongs to
                 * the existing parser/repair path.
                 */
                if (!completion.incomplete) {
                    return state.text;
                }

                if (!incompleteSince) {
                    incompleteSince =
                        Date.now();

                    /*
                     * JSON grace owns its full settling window.
                     *
                     * Do not let the original request deadline expire
                     * halfway through the promised 12-second wait.
                     */
                    deadline =
                        Math.max(
                            deadline,
                            incompleteSince +
                                JSON_COMPLETION_GRACE_MS +
                                1000
                        );
                }

                if (!incompleteLogged) {
                    incompleteLogged =
                        true;

                    console.warn(
                        '[GEMINI WEB] JSON response appears incomplete; waiting up to 12s for additional text'
                    );
                }

                if (
                    Date.now() -
                        incompleteSince >=
                    JSON_COMPLETION_GRACE_MS
                ) {
                    const rawResponse =
                        cleanResponse(
                            state.text
                        );

                    const error =
                        new Error(
                            'Gemini Web JSON response remained incomplete after settling'
                        );

                    error.code =
                        'GEMINI_WEB_INCOMPLETE_JSON';

                    error.rawResponse =
                        rawResponse;

                    error.originalRawResponse =
                        rawResponse;

                    error.rawResponseLength =
                        rawResponse.length;

                    error.rawResponseShownLength =
                        Math.min(
                            rawResponse.length,
                            100000
                        );

                    error.rawResponseTruncated =
                        rawResponse.length >
                        100000;

                    error.parserReason =
                        'Response stopped before the JSON document was structurally complete';

                    error.responseDomDebug =
                        state.debug ||
                        null;

                    console.warn(
                        '[GEMINI WEB INCOMPLETE FINAL DEBUG]',
                        JSON.stringify({
                            selectedTextLength:
                                state.text.length,
                            generatingDiagnosticOnly:
                                state.generating,
                            responseFinished:
                                state.responseFinished,
                            responseCompletionControls:
                                state.responseCompletionControls,
                            stableCount,
                            incompleteForMs:
                                Date.now() -
                                incompleteSince,
                            debug:
                                state.debug ||
                                null
                        })
                    );

                    throw error;
                }
            }
        }

        if (
            !started &&
            /reached your limit|too many requests|try again later|couldn.t generate|something went wrong/i
                .test(state.alerts)
        ) {
            const error =
                new Error(
                    'Gemini Web reported a generation/rate-limit error'
                );

            error.code =
                'GEMINI_WEB_GENERATION_ERROR';

            throw error;
        }

        await sleep(500);
    }

    const error =
        new Error(
            'Gemini Web response timed out'
        );

    error.code =
        'GEMINI_WEB_TIMEOUT';
    error.rawResponse = cleanResponse(lastState?.text || '');
    error.responseDomDebug = lastState?.debug || null;
    error.timeoutMs = timeoutMs;
    error.responseStarted = started;
    error.responseMatchesBaseline = Boolean(lastState?.text && lastState.text === baseline);

    throw error;
}

function cleanResponse(text) {
    return String(text || '')
        .trim()
        .replace(
            /^Gemini said\s*/i,
            ''
        )
        .trim()
        .replace(
            /^```(?:json)?\s*/i,
            ''
        )
        .replace(
            /\s*```$/,
            ''
        )
        .trim();
}


/*
 * Repair one common model-JSON failure:
 *
 *   {"text":"... "quoted words" ..."}
 *
 * Only quotes that cannot plausibly terminate the current JSON
 * string are escaped. If the repaired text still does not parse,
 * the original provider failure path is used unchanged.
 */
export function repairGeminiWebJsonQuotes(value) {
    const input =
        String(value ?? '');

    let output = '';
    let inString = false;
    let escaped = false;
    let changed = false;

    const skipWhitespace = index => {
        let next = index;

        while (
            next < input.length &&
            /\s/.test(input[next])
        ) {
            next++;
        }

        return next;
    };

    for (
        let index = 0;
        index < input.length;
        index++
    ) {
        const character =
            input[index];

        if (!inString) {
            output += character;

            if (character === '"') {
                inString = true;
                escaped = false;
            }

            continue;
        }

        if (escaped) {
            output += character;
            escaped = false;
            continue;
        }

        if (character === '\\') {
            output += character;
            escaped = true;
            continue;
        }

        if (character !== '"') {
            output += character;
            continue;
        }

        const nextIndex =
            skipWhitespace(
                index + 1
            );

        const nextCharacter =
            input[nextIndex];

        let structuralClose =
            nextIndex >=
                input.length ||
            nextCharacter === ':' ||
            nextCharacter === '}' ||
            nextCharacter === ']';

        /*
         * A comma is structural only when the following token can
         * actually begin another JSON key/value. This avoids treating
         * prose such as:
         *
         *   "word", then ...
         *
         * as a legitimate string terminator.
         */
        if (
            !structuralClose &&
            nextCharacter === ','
        ) {
            const afterCommaIndex =
                skipWhitespace(
                    nextIndex + 1
                );

            const afterComma =
                input[
                    afterCommaIndex
                ];

            // GEMINI_WEB_JSON_QUOTE_TOKEN_BOUNDARY_V2
            // Do not treat an arbitrary prose word beginning with t/f/n
            // (for example Vietnamese "người") as true/false/null.
            // Only accept a scalar after the comma when a complete JSON
            // literal/number token is present and followed by a delimiter.
            const afterCommaText =
                input.slice(
                    afterCommaIndex
                );

            const scalarToken =
                /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}\]])/
                    .test(
                        afterCommaText
                    );

            structuralClose =
                afterCommaIndex >=
                    input.length ||
                afterComma === '"' ||
                afterComma === '}' ||
                afterComma === ']' ||
                afterComma === '{' ||
                afterComma === '[' ||
                scalarToken;
        }

        if (structuralClose) {
            output += '"';
            inString = false;
            continue;
        }

        output += '\\"';
        changed = true;
    }

    return {
        text:
            output,
        changed
    };
}

function buildInput(prompt, options) {
    let input =
        'Use only the information supplied in this prompt. ' +
        'Do not browse the web or use external tools.\n\n' +
        String(prompt || '');

    if (options?.schema) {
        input +=
            '\n\nReturn output that conforms exactly to this JSON Schema:\n' +
            JSON.stringify(options.schema);
    }

    if (options?.json) {
        input +=
            '\n\nReturn valid JSON only. Do not wrap it in Markdown fences.';
    }

    return input;
}

async function resetGeminiJobPage(page) {
    const currentUrl = await page.evaluate(() => location.href);
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    if (!/^https:\/\/gemini\.google\.com\//i.test(currentUrl || '')) {
        await page.goto(GEMINI_WEB_URL);
        await waitForGeminiPage(page, 20000);
    }
    // No page reload/new tab as a fallback: fail closed rather than
    // risk submitting a job into an existing or non-temporary chat.
    await returnToGeminiChatHome(page);
    await resetFreshTemporaryChat(page);
}

async function runOnSlot(
    slot,
    prompt,
    options
) {
    const page =
        await getPage(slot);

    try {
        /*
         * Reuse this slot's existing browser tab, but start
         * every job from a completely fresh Gemini page.
         */
        await resetGeminiJobPage(page);

        /*
         * Strict requirements:
         * 1. Temporary Chat must be ON.
         * 2. Model must be 3.8 Flash.
         * 3. Extended thinking must NOT be selected.
         *
         * Gemini occasionally renders the prompt box before
         * the mode picker. If that happens once, hard-reset
         * this SAME tab and retry.
         */
        try {
            await ensureModel(
                page,
                options?.geminiWebMode ||
                    '3.8'
            );
        } catch (error) {
            if (
                error?.code !==
                'GEMINI_WEB_MODE_PICKER_NOT_FOUND'
            ) {
                throw error;
            }

            console.warn(
                `[GEMINI WEB] Slot ${slot.id}: mode picker missing; retrying fresh chat on same tab`
            );

            await resetGeminiJobPage(page);
            await ensureModel(
                page,
                options?.geminiWebMode ||
                    '3.8'
            );
        }

        const ready = await temporaryChatState(page);
        if (!ready.activeTemporaryDom || ready.iconName !== 'close' ||
            !ready.freshRoute || !ready.conversationEmpty) {
            return providerError(page,
                'Temporary Chat was not confirmed immediately before submission',
                'GEMINI_WEB_TEMP_CHAT_NOT_CONFIRMED');
        }

        const before =
            await responseState(page);

        const input =
            buildInput(
                prompt,
                options
            );

        await setPrompt(
            page,
            input
        );

        options.onRequest?.();

        await submitPrompt(page);

        return await waitForResponse(
            page,
            before.text || '',
            Math.max(
                5000,
                Math.min(
                    180000,
                    Number(options.timeoutMs) ||
                    120000
                )
            ),
            Boolean(options?.json)
        );
    } catch (error) {
        // Provider errors do not mean the physical tab is broken. Preserve
        // its lease and reset the conversation in that same tab on the next job.
        console.warn(`[GEMINI WEB] Slot ${slot.id}: preserving tab after ${error.code || error.name}`);
        throw error;
    }
}

export async function closeGeminiWebSlots() {
    await Promise.all(
        slots.map(
            slot =>
                closeSlotPage(
                    slot,
                    'manual cleanup'
                )
        )
    );
}


export async function generateWithGeminiWeb(
    prompt,
    options = {}
) {
    if (!geminiWebConfigured()) {
        const error =
            new Error(
                'Gemini Web provider is disabled'
            );

        error.code =
            'NOT_CONFIGURED';

        error.skipProvider =
            true;

        error.nonProviderFault =
            true;

        throw error;
    }

    if (Date.now() < retryAt) {
    const error =
        new Error(
            `Gemini Web is cooling down until ${
                new Date(retryAt).toISOString()
            }; use the next provider`
        );

    error.code =
        'GEMINI_WEB_COOLDOWN';

    error.retryAt =
        retryAt;

    error.cooldownUntil =
        retryAt;

    error.skipProvider =
        true;

    error.nonProviderFault =
        true;

    throw error;
}

const inputBytes =
        Buffer.byteLength(
            String(prompt || ''),
            'utf8'
        );

    if (inputBytes > 180000) {
        throw new Error(
            'Gemini Web prompt is too large'
        );
    }

    const slot =
        acquireSlot();

    const startedAt =
        Date.now();

    try {
    let rawText;

    let firstIncompleteRawResponse =
        null;

    try {
        rawText =
            await runOnSlot(
                slot,
                prompt,
                options
            );
    }
    catch (error) {
        if (
            !options?.json ||
            error?.code !==
                'GEMINI_WEB_INCOMPLETE_JSON'
        ) {
            throw error;
        }

        firstIncompleteRawResponse =
            error?.rawResponse ||
            '';

        console.warn(
            '[GEMINI WEB] Incomplete JSON remained stable; regenerating once'
        );

        rawText =
            await runOnSlot(
                slot,
                prompt,
                options
            );
    }

        let text =
              cleanResponse(rawText);
          const originalText = text;

        if (!text) {
            const error =
                new Error(
                    'Gemini Web returned an empty response'
                );

            error.code =
                'GEMINI_WEB_EMPTY';

            throw error;
        }

        if (options.json) {
            try {
                JSON.parse(text);
            }
            catch (parseError) {
                const repair =
                    repairGeminiWebJsonQuotes(
                        text
                    );

                let repaired =
                    false;

                let repairedParseError =
                    null;

                if (repair.changed) {
                    try {
                        JSON.parse(
                            repair.text
                        );

                        text =
                            repair.text;

                        repaired =
                            true;

                        console.warn(
                            '[GEMINI WEB] Repaired unescaped quote(s) inside model JSON'
                        );
                    }
                    catch (error) {
                        repairedParseError =
                            error;
                    }
                }

                if (!repaired) {
                    const error =
                        new Error(
                            'Gemini Web returned invalid JSON'
                        );

                    error.code =
                        'GEMINI_WEB_INVALID_JSON';

                    error.rawResponse =
                        originalText;

                    error.originalRawResponse =
                        originalText;

                    if (
                        firstIncompleteRawResponse
                    ) {
                        error.firstRawResponse =
                            firstIncompleteRawResponse;
                    }

                    error.rawResponseLength =
                        originalText.length;

                    error.rawResponseShownLength =
                        Math.min(
                            originalText.length,
                            100000
                        );

                    error.rawResponseTruncated =
                        originalText.length >
                        100000;

                    error.repairAttempted =
                        repair.changed;

                    error.parserReason =
                        String(
                            parseError?.message ||
                            'JSON.parse failed'
                        ).slice(
                            0,
                            500
                        );

                    if (repairedParseError) {
                        error.repairedParserReason =
                            String(
                                repairedParseError?.message ||
                                'Repaired JSON.parse failed'
                            ).slice(
                                0,
                                500
                            );
                    }

                    error.reason =
                        error.parserReason;

                    error.originalReason =
                        error.parserReason;

                    throw error;
                }
            }
        }

        retryAt = 0;

        const usage = {
            promptTokens: 0,
            outputTokens: 0,
            totalTokens: 0
        };

        console.log(
            '[ONLINE AI]',
            JSON.stringify({
                at:
                    new Date()
                        .toISOString(),
                provider:
                    'gemini-web',
                operation:
                    options.operation ||
                    'summary',
                model:
                    GEMINI_WEB_MODEL,
                slot:
                    slot.id,
                status:
                    'success',
                durationMs:
                    Date.now() -
                    startedAt,
                ...usage
            })
        );

        return {
            text,
            provider:
                'gemini-web',
            modelUsed:
                GEMINI_WEB_MODEL,
            totalDuration:
                (
                    Date.now() -
                    startedAt
                ) * 1e6,
            usage,
            onlineAiUsage:
                usage,
            slot:
                slot.id
        };
    } catch (error) {
        const is1095 =
            isGeminiWeb1095Error(error);

        const appliedCooldownMs =
            is1095
                ? GEMINI_WEB_1095_COOLDOWN_MS
                : GEMINI_WEB_COOLDOWN_MS;

        retryAt =
            Date.now() +
            appliedCooldownMs;

        if (is1095) {
            error.code =
                'GEMINI_WEB_1095';

            error.cooldownMs =
                appliedCooldownMs;

            error.cooldownUntil =
                retryAt;

            console.warn(
                '[GEMINI WEB] Error 1095; cooling down globally for 60 seconds',
                JSON.stringify({
                    cooldownMs:
                        appliedCooldownMs,

                    cooldownUntil:
                        new Date(
                            retryAt
                        ).toISOString()
                })
            );
        }

        console.log(
            '[ONLINE AI]',
            JSON.stringify({
                at:
                    new Date()
                        .toISOString(),
                provider:
                    'gemini-web',
                operation:
                    options.operation ||
                    'summary',
                model:
                    GEMINI_WEB_MODEL,
                slot:
                    slot.id,
                status:
                    'failed',
                durationMs:
                    Date.now() -
                    startedAt,
                errorCode:
                    String(
                        error.code ||
                        error.name ||
                        'GEMINI_WEB_FAILED'
                    ).slice(0, 80),
                error:
                    String(
                        error.message ||
                        error
                    )
                        .replace(
                            /\s+/g,
                            ' '
                        )
                        .slice(
                            0,
                            500
                        ),
                parserReason:
                    error.parserReason ||
                    error.originalReason ||
                    error.reason ||
                    undefined,
                rawResponse:
                    error.rawResponse
                        ? String(error.rawResponse).slice(0, 100000)
                        : undefined,
                rawResponseLength:
                    error.rawResponse
                        ? String(error.rawResponse).length
                        : undefined,
                rawResponseShownLength:
                    error.rawResponse
                        ? Math.min(
                            String(error.rawResponse).length,
                            100000
                        )
                        : undefined,
                rawResponseTruncated:
                    error.rawResponse
                        ? String(error.rawResponse).length > 100000
                        : false,
                responseStarted: error.responseStarted,
                responseMatchesBaseline: error.responseMatchesBaseline,
                timeoutMs: error.timeoutMs,
                ui:
                    error.ui ||
                    undefined
            })
        );

        throw error;
    } finally {
        releaseSlot(slot);
    }
}

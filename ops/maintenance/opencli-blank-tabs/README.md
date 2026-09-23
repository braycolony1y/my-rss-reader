# OpenCLI blank-tab fix

The installed Browser Bridge 1.0.24 converts the final owned tab into an active
`about:blank` placeholder in `releaseLease()`. Both `close-window` and explicit
`tabs close` reach this function, so changing the reader to call `closeTab()`
does not fix the leak.

`install.mjs` patches the installed extension to remove owned tabs, preserve
borrowed user tabs, and serialize lease creation/removal. It also installs a
Chrome alarm that checks every five minutes for abandoned blank tabs. Cleanup
requires two observations at least a minute apart, checks ownership again before
removal, and skips pinned, loading, navigating, and leased tabs. It only scans
OpenCLI groups and the current adapter container. No OS cron job is needed; the
alarm runs in the browser and is recreated when the extension starts.

Install or reapply after replacing the extension:

```sh
node ops/maintenance/opencli-blank-tabs/install.mjs /home/ubuntu/opencli-extension-1.0.24
```

Then reload OpenCLI through Chromium's extensions page, or open its local
`reload-blank-fix.html` page. This reloads only the extension. The installer keeps
the original bundle at `dist/background.js.before-blank-tab-fix` and refuses
unrecognized upstream implementations. Replacing/upgrading the extension can
overwrite this local patch.

The bridge command `blank-cleanup-status` reports the patch version, cleanup
alarm period, blank-tab metadata and number of removed orphans without creating
a browser tab. Normal tab URLs and page content are not included.

Regression tests:

```sh
node test/opencli-blank-tabs.test.js
```

The separate background-tab patch fixes Browser Bridge 1.0.24's three tab
creation paths, which otherwise hard-code `active: true` even for background
sessions. Reapply after replacing the extension:

```sh
node ops/maintenance/opencli-background-tabs.mjs /home/ubuntu/opencli-extension-1.0.24
```

Reload the extension to activate it. The installer provides a self-closing
`reload-background-tabs.html` extension page and saves the original bundle as
`dist/background.js.before-background-tabs`. Background requests create inactive
tabs; explicitly foreground requests retain their normal behavior. The reader's
`src/browser/opencli-page.js` also remembers target IDs returned by evaluations
and recovers existing session leases before navigation, preventing duplicate tabs
after a process or bridge reconnect. Gemini leases have no idle expiry; provider
errors reset the next conversation in the same tab instead of closing it.

Each Gemini job starts New chat and enables Temporary Chat. A reload is used
only if New chat fails. Focus emulation lets Gemini render in an inactive tab
without selecting it. Complete new JSON is accepted without waiting for Copy
or other response controls to become visible.

`node test/browser-tab-lifecycle.test.js` tests these contracts without a browser.
`node test/helpers/gemini-tab-reuse-live.mjs` is an opt-in smoke test that sends
two tiny synthetic Gemini prompts in one disposable inactive tab, then closes it.

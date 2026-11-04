import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiWebPage } from '../src/ai/gemini-web-page.js';
import { resolveProfileRoute } from '../node_modules/@jackwener/opencli/dist/src/daemon-utils.js';

class FakePage {
    constructor(...args) { this.args = args; }
}

function createPage(env, defaultProfile) {
    return createGeminiWebPage(FakePage, 7, {
        env,
        resolveProfile: profile => profile
            ? { contextId: profile === 'work' ? 'work-id' : profile, source: 'explicit' }
            : defaultProfile && { contextId: defaultProfile, source: 'preferred' }
    });
}

test('profile configuration loaded after import routes Gemini with multiple connected profiles', t => {
    const names = ['GEMINI_WEB_PROFILE', 'OPENCLI_BROWSER_PROFILE', 'OPENCLI_PROFILE'];
    const original = names.map(name => process.env[name]);
    t.after(() => names.forEach((name, index) => {
        if (original[index] === undefined) delete process.env[name];
        else process.env[name] = original[index];
    }));
    names.forEach(name => { delete process.env[name]; });
    // The factory was imported before configuration populated process.env.
    process.env.OPENCLI_BROWSER_PROFILE = 'work-id';
    const page = createGeminiWebPage(FakePage, 7);
    assert.deepEqual(page.args, ['rss-gemini-web-7', -1, 'work-id', 'background', 'browser', 'persistent', undefined]);
    assert.deepEqual(resolveProfileRoute({
        requestedContextId: page.args[2], preferredContextId: page.args[6],
        connectedContextIds: ['personal-id', 'work-id']
    }), { ok: true, contextId: 'work-id' });
});

test('Gemini profile takes precedence over browser and general profiles, ignoring whitespace', () => {
    assert.equal(createPage({ GEMINI_WEB_PROFILE: ' gemini ', OPENCLI_BROWSER_PROFILE: 'browser', OPENCLI_PROFILE: 'general' }).args[2], 'gemini');
    assert.equal(createPage({ GEMINI_WEB_PROFILE: ' ', OPENCLI_BROWSER_PROFILE: ' browser ', OPENCLI_PROFILE: 'general' }).args[2], 'browser');
    assert.equal(createPage({ OPENCLI_PROFILE: ' general ' }).args[2], 'general');
});

test('an explicitly configured disconnected profile cannot switch Gemini accounts', () => {
    const page = createPage({ GEMINI_WEB_PROFILE: 'work' });
    const route = resolveProfileRoute({ requestedContextId: page.args[2], connectedContextIds: ['personal-id'] });
    assert.equal(route.ok, false);
    assert.equal(route.errorCode, 'profile_disconnected');
});

test('without an explicit profile, retain OpenCLI default preference and automatic routing', () => {
    const preferred = createPage({}, 'default-id');
    assert.equal(preferred.args[2], undefined);
    assert.equal(preferred.args[6], 'default-id');
    const automatic = createPage({});
    assert.equal(automatic.args[2], undefined);
    assert.equal(automatic.args[6], undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSettingsRoutes } from '../src/routes/settings-routes.js';

test('two devices retain concurrent read writes and receive VOZ positions and removals', async () => {
    const handlers = {};
    const state = { userPreferences: { voz_last_read_post_123456: '{"index":"42","absId":"789"}' }, readStates: [], savedStates: ['https://example.com/saved'] };
    registerSettingsRoutes({
        app: { get: (url, ...args) => handlers[url] = args.at(-1), post: (url, ...args) => handlers[url] = args.at(-1) },
        env: { RSS_DATA: {
            get: async key => structuredClone(state[key]),
            put: async (key, value) => { await new Promise(resolve => setTimeout(resolve, 5)); state[key] = JSON.parse(value); }
        } },
        normalizeClusteringModel: value => value
    });
    const response = () => ({ setHeader() {}, status() { return this; }, send() {}, json(value) { this.data = value; } });
    await Promise.all(['a', 'b'].map(id => handlers['/api/toggle']({ body: { link: `https://example.com/${id}`, list: 'readStates', forceAdd: true } }, response())));
    let res = response();
    await handlers['/api/user-states']({}, res);
    assert.equal(res.data.readStates.length, 2);
    assert.equal(res.data.userPreferences.voz_last_read_post_123456, state.userPreferences.voz_last_read_post_123456);
    assert.deepEqual(res.data.savedStates, state.savedStates);
    await handlers['/api/toggle-batch']({ body: { links: ['https://example.com/a/'], list: 'readStates', forceRemove: true } }, response());
    res = response();
    await handlers['/api/user-states']({}, res);
    assert.deepEqual(res.data.readStates, ['https://example.com/b']);
});

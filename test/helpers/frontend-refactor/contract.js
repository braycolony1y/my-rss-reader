import vm from 'node:vm';
import { createHash } from 'node:crypto';

// Capture values and accessors without invoking getters or starting the app.
// Used with a saved pre-extraction script, rather than duplicating its logic.
export function inspectClientContract(source) {
    const listeners = [], storageReads = [];
    const hash = value => createHash('sha256').update(value).digest('hex');
    const on = target => (type, listener, options) => listeners.push({ target, type, body: hash(listener.toString()), options });
    const storage = { getItem(key) { storageReads.push(key); return null; }, setItem() {} };
    const context = vm.createContext({
        document: { cookie: '', readyState: 'loading', hidden: false, addEventListener: on('document'),
            querySelector: () => null, querySelectorAll: () => [], documentElement: {}, body: null },
        window: { innerWidth: 1200, addEventListener: on('window'), location: { hash: '', origin: 'http://localhost' } },
        navigator: { maxTouchPoints: 0 }, localStorage: storage, sessionStorage: storage,
        location: { hash: '' }, Date: { now: () => 1000 }, crypto: { randomUUID: () => 'fixture-id' },
        MutationObserver: class { observe() {} },
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
        fetch: async () => ({ ok: true, json: async () => ({}) }), URL, URLSearchParams, console
    });
    vm.runInContext(source, context);
    const app = vm.runInContext('rssApp()', context);
    const snapshot = value => {
        const type = Object.prototype.toString.call(value);
        if (typeof value === 'function') return { function: hash(value.toString()) };
        if (['[object Promise]', '[object WeakMap]'].includes(type)) return { type };
        if (type === '[object Set]' || type === '[object Map]') return { type, entries: [...value] };
        if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
        return value;
    };
    const descriptors = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app)).sort(([a], [b]) => a.localeCompare(b)).map(([name, descriptor]) => [name,
        Object.fromEntries(Object.entries(descriptor).map(([key, value]) => [key, snapshot(value)]))]));
    return { descriptors, listeners, storageReads };
}

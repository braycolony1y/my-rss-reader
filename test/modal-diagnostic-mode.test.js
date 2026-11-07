import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installDiagnosticMode } from '../tools/experiments/modal-reliability/diagnostic-mode.mjs';
import { startDiagnosticServer } from '../tools/experiments/modal-reliability/diagnostic-server.mjs';
import { diagnosticRequestAllowed } from '../tools/experiments/modal-reliability/diagnostic-guard.mjs';

function environment(selected) {
    const scheduled = [], messages = [];
    const document = { cookie: '', body: {}, addEventListener() {}, removeEventListener() {} };
    const win = { setInterval: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
        clearInterval() {}, fetch: async () => ({ status: 200 }), addEventListener() {} };
    const context = vm.createContext({ window: win, document, location: { hostname: '127.0.0.1',
        search: selected ? '?flicker=' + selected : '', href: 'http://127.0.0.1:4317/' },
        performance: { now: () => 10, timeOrigin: 1000 }, URLSearchParams, URL, Date,
        console: { info: (...args) => messages.push(args) } });
    return { context, win, document, scheduled, messages };
}

test('diagnostics require an explicit development gate and loopback origin', () => {
    const env = environment('nobackdrop'), original = env.win.setInterval;
    assert.equal(vm.runInContext(`(${installDiagnosticMode.toString()})({})`, env.context).enabled, false);
    assert.equal(env.win.setInterval, original);
    env.context.location.hostname = 'production.example';
    assert.equal(vm.runInContext(`(${installDiagnosticMode.toString()})({developmentOnly:true})`, env.context).enabled, false);
    assert.equal(env.win.setInterval, original);
});

test('each polling switch blocks only its recurring callback and leaves initial and unrelated loads intact', () => {
    for (const [mode, method, delay] of [['noai2poll', 'fetchSmartAiProgress', 2000],
        ['noprovider5poll', 'fetchGeminiDebugStats', 5000], ['noactivity60poll', 'fetchOnlineAiUsage', 60000]]) {
        const env = environment(mode);
        vm.runInContext(`(${installDiagnosticMode.toString()})({developmentOnly:true,fixture:true})`, env.context);
        let initial = 0; const app = { [method]: () => initial++ };
        app[method]();
        const recurring = Function('app', `return () => app.${method}()`)(app);
        const suppressed = env.win.setInterval(recurring, delay);
        assert.ok(suppressed < 0); assert.equal(initial, 1); assert.equal(env.scheduled.length, 0);
        env.win.setInterval(() => {}, delay);
        env.win.setInterval(recurring, delay + 1);
        assert.equal(env.scheduled.length, 2);
        assert.equal(env.win.__flickerDiagnostic.export().selected, mode);
        assert.ok(env.messages.length);
    }
});

test('the diagnostic server refuses default activation and non-loopback live backends', async () => {
    await assert.rejects(startDiagnosticServer(), /disabled/);
    await assert.rejects(startDiagnosticServer({ enabled: true, upstream: 'https://example.com' }), /loopback/);
});

test('live diagnostic requests require the intended loopback host and same-origin writes', () => {
    const request = (method, headers = {}) => ({ method, headers: { host: '127.0.0.1:4317', ...headers } });
    assert.equal(diagnosticRequestAllowed(request('GET'), 4317), true);
    assert.equal(diagnosticRequestAllowed(request('GET', { host: 'evil.example:4317' }), 4317), false);
    assert.equal(diagnosticRequestAllowed(request('GET', { host: '127.0.0.1:3000' }), 4317), false);
    assert.equal(diagnosticRequestAllowed(request('GET', { 'sec-fetch-site': 'cross-site' }), 4317), false);
    assert.equal(diagnosticRequestAllowed(request('POST'), 4317), false);
    assert.equal(diagnosticRequestAllowed(request('POST', { origin: 'https://evil.example' }), 4317), false);
    assert.equal(diagnosticRequestAllowed(request('POST', { origin: 'http://127.0.0.1:4317' }), 4317), true);
});

test('manual flicker marks also create a trace-correlatable User Timing entry', () => {
    const env = environment(''), marks = [];
    env.context.performance.mark = name => marks.push(name);
    vm.runInContext(`(${installDiagnosticMode.toString()})({developmentOnly:true})`, env.context);
    env.win.__flickerDiagnostic.mark();
    assert.equal(marks.length, 1); assert.match(marks[0], /^rss-flicker-mark-/);
    assert.equal(env.win.__flickerDiagnostic.export().records.at(-1).timingMark, marks[0]);
});

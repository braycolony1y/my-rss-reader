// Block benchmark writes inside the page. Playwright routing of all API GETs
// pauses each request for a Node round trip and contaminates dispatch timing.
export async function protectBrowserApiWrites(context) {
    await context.addInitScript(() => {
        const api = input => {
            const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
            return url.origin === location.origin && url.pathname.startsWith('/api/');
        };
        const original = window.fetch;
        window.fetch = (input, init) => {
            const method = String(init?.method || input?.method || 'GET').toUpperCase();
            if (api(input) && !['GET', 'HEAD'].includes(method)) {
                return Promise.resolve(new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}}));
            }
            return original.call(window, input, init);
        };
        const beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = (url, data) => api(url) ? true : beacon(url, data);
    });
}

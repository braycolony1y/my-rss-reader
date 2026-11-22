export function diagnosticRequestAllowed(req, port) {
    let host;
    try { host = new URL('http://' + req.headers.host); } catch { return false; }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || Number(host.port || 80) !== port) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = req.headers.origin;
    if (origin && origin !== host.origin) return false;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin !== host.origin) return false;
    return true;
}

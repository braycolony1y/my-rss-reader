import { accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolveOpenCliExecutable({ moduleUrl = import.meta.url, executable = fileURLToPath(new URL('../../node_modules/.bin/opencli', moduleUrl)), access = accessSync } = {}) {
    try { access(executable, constants.X_OK); return executable; }
    catch { return 'opencli'; }
}

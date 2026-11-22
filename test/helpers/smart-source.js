import { readFileSync, readdirSync } from 'node:fs';

export function smartModuleFiles(directory = new URL('../../src/smart/', import.meta.url)) {
  try {
    return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      return entry.isDirectory() ? smartModuleFiles(file) : entry.name.endsWith('.js') ? [file] : [];
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function readSmartSource() {
  return [new URL('../../smart-news.js', import.meta.url), ...smartModuleFiles()]
    .map(file => readFileSync(file, 'utf8')).join('\n');
}

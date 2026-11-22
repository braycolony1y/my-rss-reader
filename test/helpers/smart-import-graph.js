import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { smartModuleFiles } from './smart-source.js';

export function assertSmartImportGraphAcyclic() {
  const visited = new Set();
  const active = [];
  function visit(file) {
    const name = fileURLToPath(file);
    const cycleStart = active.indexOf(name);
    if (cycleStart >= 0) throw new Error('Smart import cycle: ' + [...active.slice(cycleStart), name].join(' -> '));
    if (visited.has(name)) return;
    active.push(name);
    const source = readFileSync(file, 'utf8');
    const imports = /(?:\bimport\s+(?:[\s\S]*?\sfrom\s*)?|\bexport\s+(?:\*|\{[^}]*\})\s+from\s*)['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(imports)) {
      if (!match[1].startsWith('.')) continue;
      const target = new URL(match[1], file);
      if (existsSync(target) && target.pathname.endsWith('.js')) visit(target);
    }
    active.pop();
    visited.add(name);
  }
  visit(new URL('../../smart-news.js', import.meta.url));
  for (const file of smartModuleFiles()) visit(file);
  return visited.size;
}

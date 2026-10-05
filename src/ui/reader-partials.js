import { fileURLToPath } from 'node:url';

// Explicit allowlist: partial names never come from request parameters.
export const READER_COMPONENT_PATHS = Object.fromEntries([
    'login', 'sidebar', 'header', 'smart/navigation', 'article-list',
    'action-status', 'tooltip', 'article/overlay', 'article/overlay-header',
    'article/summary', 'modals/add-feed', 'modals/content-filter',
    'modals/ai-status', 'modals/smart-sources', 'modals/edit-source',
    'modals/logs', 'modals/boards', 'modals/article-debug',
    'modals/ai-providers', 'modals/cache', 'smart/feedback-button', 'smart/feedback-picker', 'modals/filter-log'
].map(name => [name, fileURLToPath(new URL(`../../public/components/${name}.html`, import.meta.url))]));

// Composition happens before sending the document. No additional DOM nodes,
// network requests or Alpine scopes are introduced. Include-line formatting
// is discarded; the partial itself owns the original surrounding whitespace.
export function composeReaderPartials(source, partials, stack = []) {
    return source.replace(/<!-- reader:include ([a-z0-9/-]+) -->\r?\n?/g, (_, name) => {
        if (!Object.hasOwn(partials, name)) throw new Error(`Missing reader partial: ${name}`);
        if (stack.includes(name)) throw new Error(`Circular reader partial: ${[...stack, name].join(' -> ')}`);
        return composeReaderPartials(partials[name], partials, [...stack, name]);
    });
}

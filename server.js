import { fileURLToPath } from 'node:url';
import { createApplication } from './src/app.js';

// Preserve the parsing API used by existing integrations and regression tests.
export { parseJinaReaderText, parseOpenCliMarkdown, trimJinaArticleMarkdown, stripJinaLeadingNavigation, jinaMarkdownToHtml } from './src/articles/reader-markdown.js';
export { cleanArticleMarkup } from './src/articles/markup.js';
export { normalizeArticleMediaMarkup } from './article-media.js';
export { normalizeArticleTitle, fastParseRSS } from './feed-parsers.js';
export { parseOpenCliSearchDestination } from './src/articles/search-destination.js';
export { parseBaoMoi, parseMorningstar, parseTechcombank, parseUOB, parseUOBVN } from './src/feeds/source-parsers.js';

const isMainModule = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
const application = await createApplication({ isMainModule });

// Bind HTTP before starting any heavy work. Startup owns the original
// immediate RSS phase and the 30/45/60/90-second staggered phases.
if (isMainModule) {
    application.app.listen(application.port, () => {
        console.log(`🚀 RSS Reader running on http://localhost:${application.port}`);
        application.startBackgroundServices();
    });
}

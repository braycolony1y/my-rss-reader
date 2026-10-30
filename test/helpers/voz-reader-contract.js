import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function assertVozBackgroundFeedPolicy(script) {
    const effects = readFileSync(new URL('../../public/js/article/render-effects.js', import.meta.url), 'utf8');
    assert.match(script, /ReaderArticleRenderEffects\.afterInsert\(/);
    assert.match(effects, /checkVozNewPostsInBackground\(\s*activeVozUrl,\s*activeFeedUrl\s*\)/);
    assert.match(effects, /const activeFeedUrl = app\.overlayArticle\?\.feedUrl \|\| ''/);
    assert.match(effects, /if \(app\.overlayFetchedFromCache\)/);
    assert.match(script, /fetchThreadPage\(\s*currentLiveUrl,\s*feedUrl,\s*false,\s*true/);
    assert.match(script, /params\.set\('bypassCache', 'true'\)/);
    assert.match(script, /this\.overlayArticle\.sourceDeleted = data\.sourceDeleted === true/);
}

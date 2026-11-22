import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

export function verifyArticleCardStyleOwnership(html, script) {
    assert.match(html, /href="\/public\/top-story-card\/card\.css\?v=/);
    for (const name of ['top-story-card/legacy-base.css', 'top-story-card/legacy-inline.css', 'card-blend/surface.css', 'card-blend/layout.css', 'card-blend/content.css']) {
        const css = readFileSync(new URL(`../../public/${name}`, import.meta.url), 'utf8');
        postcss.parse(css).walkRules(rule => {
            if (/\.article-card(?:[\s.:[-]|$)|\.has-story-briefing/.test(rule.selector)) {
                assert.ok(rule.selectors.every(selector => selector.includes(':not(:where(.theme-glass-light [data-image-layout="top"]')),
                    `${name}: legacy rules cannot style the light Top Story variant`);
            }
        });
    }
    const css = readFileSync(new URL('../../public/top-story-card/card.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /!important|11\.5rem/);
    assert.doesNotMatch(html, /article-card-media/);
    assert.match(script, /url\.startsWith\('\/api\/og-image'\)[\s\S]*versioned\.searchParams\.set\('v', '32'\)/);
}

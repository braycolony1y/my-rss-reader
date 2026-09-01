import assert from 'node:assert/strict';
import test from 'node:test';
import VnexpressSource from '../src/sources/VnexpressSource.js';

test('VnExpress exposes its nested HLS player instead of leaving it hidden', () => {
    const source = new VnexpressSource();
    const content = source.parseArticleHtmlContent(`
        <article class="fck_detail">
            <p>Article introduction with enough information to represent the report.</p>
            <div id="embed_video_453413" style="display:none;">
                <div id="parser_player_453413" class="media_content" style="display:none;">
                    <video controls playsinline src="https://d1.vnecdn.net/video/master.m3u8"></video>
                </div>
            </div>
            <p>Article conclusion after the video player.</p>
        </article>
    `, 'https://vnexpress.net/example-5115303.html', {}, {});

    assert.match(content, /id="embed_video_453413" style=""/);
    assert.match(content, /id="parser_player_453413"[^>]*style=" display: block;"/);
    assert.match(content, /<video[^>]+src="https:\/\/d1\.vnecdn\.net\/video\/master\.m3u8"/);
    assert.doesNotMatch(content, /parser_player_453413[^>]+display:\s*none/i);
});

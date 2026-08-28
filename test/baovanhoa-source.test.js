import test from 'node:test';
import assert from 'node:assert/strict';

import BaovanhoaSource from '../src/sources/BaovanhoaSource.js';

test('Báo Văn Hóa parser keeps the article and removes publisher modules', () => {
    const source = new BaovanhoaSource();
    const result = { author: 'https://www.facebook.com/baovanhoa' };
    const parsed = source.parseArticleHtmlContent(`
        <article class="article-detail">
            <header class="detail__header">
                <span class="detail__author fw-bold"> VĨNH HY, ảnh: VFF </span>
                <div>Theo dõi Báo Văn Hóa trên Google News</div>
            </header>
            <div class="detail__content-wrap">
                <div class="detail__content">
                    <h2 class="detail__summary">Article summary.</h2>
                    <p>Main story text.</p>
                    <figure><img data-original="https://media.baovanhoa.vn/photo.jpg"></figure>
                    <div class="notification"><p>Xem ASEAN Cup trên FPT Play</p></div>
                    <div class="adsitem"><script>advertisement()</script></div>
                </div>
                <footer class="detail__footer">Tin liên quan</footer>
                <section class="detail__related">Đọc tiếp</section>
            </div>
        </article>
    `, 'https://baovanhoa.vn/example.html', result);

    assert.equal(result.author, 'VĨNH HY, ảnh: VFF');
    assert.match(parsed, /Article summary/);
    assert.match(parsed, /Main story text/);
    assert.match(parsed, /src="https:\/\/media\.baovanhoa\.vn\/photo\.jpg"/);
    assert.doesNotMatch(parsed, /Google News|FPT Play|advertisement|Tin liên quan|Đọc tiếp/);
});

test('Báo Văn Hóa parser declines pages without the known article body', () => {
    const source = new BaovanhoaSource();
    assert.equal(source.parseArticleHtmlContent('<html><body>Not an article</body></html>', 'https://baovanhoa.vn/', {}), false);
});

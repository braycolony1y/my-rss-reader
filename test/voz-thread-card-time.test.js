import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { extractVozThreadListMetadata } from '../src/feeds/voz-thread-metadata.js';

const original = '2026-10-01T02:00:00Z';
const latest = '2026-10-13T04:00:00Z';

test('VOZ listing reads starter time rather than the latest reply', () => {
    const html = `<div class="structItem structItem--thread js-threadListItem-123">
      <div class="structItem-cell structItem-cell--main">
        <div class="structItem-minor"><ul class="structItem-parts">
          <li class="structItem-startDate"><time datetime="${original}">Oct 1</time></li>
        </ul></div>
      </div>
      <div class="structItem-cell structItem-cell--meta">
        <dl class="pairs pairs--justified"><dt>Replies</dt><dd>24</dd></dl>
        <dl class="pairs pairs--justified structItem-minor"><dt>Views</dt><dd>1.2K</dd></dl>
      </div>
      <div class="structItem-cell structItem-cell--latest"><time datetime="${latest}">now</time></div>
    </div>`;
    const item = extractVozThreadListMetadata(html).get('123');
    assert.equal(item.createDate, new Date(original).toISOString());
    assert.equal(item.replies, 24);
    assert.equal(item.views, 1200);
});

test('VOZ creation date survives missing statistics; latest reply cannot replace it', () => {
    const html = `<div class="structItem js-threadListItem-456">
      <div class="structItem-cell structItem-cell--main">
        <div class="structItem-minor"><span class="structItem-startDate">
          <time datetime="${original}"></time></span></div>
      </div>
      <div class="structItem-cell structItem-cell--latest"><time datetime="${latest}"></time></div>
    </div>`;
    assert.equal(extractVozThreadListMetadata(html).get('456').createDate, new Date(original).toISOString());
    assert.equal(extractVozThreadListMetadata('<div class="structItem js-threadListItem-9"><div class="structItem-cell--latest"><time datetime="'+latest+'"></time></div></div>').has('9'), false);
});

test('card uses VOZ thread creation even when newer reply date exists', () => {
    const sandbox = vm.createContext({Intl, Date, URL});
    vm.runInContext(readFileSync(new URL('../public/js/article/presentation.js', import.meta.url), 'utf8'), sandbox);
    const app = vm.runInContext('ReaderArticlePresentation.create()', sandbox);
    app.clockNow = Date.parse('2026-10-13T05:00:00Z');
    app.cacheMember = () => null;
    const thread = {link:'https://voz.vn/t/example-thread.123/', pubDate:latest, createDate:original};
    assert.equal(app.cardSourceTime(thread), '12d');
    assert.equal(app.cardSourceTime({...thread,createDate:null}), 'Creation time unavailable');
    assert.equal(app.cardSourceTime({link:'https://example.org/news',pubDate:latest}), '60m');
    app.cacheMember = () => ({source_created_at:original,cached_at:latest});
    assert.equal(app.cardSourceTime({...thread,createDate:null}), '12d');
});

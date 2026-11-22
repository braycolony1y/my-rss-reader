import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/js/app/paint-persistence.js',import.meta.url),'utf8');
function fixture() {
 const frames=[],tasks=[],document={visibilityState:'visible'};
 const window={Alpine:{raw:value=>value.raw||value},requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>tasks.push(fn)};
 const scheduler=vm.runInNewContext(source+';ReaderPaintPersistence',{window,document});
 return {scheduler,frames,tasks,document};
}
test('read snapshots coalesce past paint and save the latest state, while exit saves stay immediate',()=>{
 const f=fixture(),saved=[],app={revision:1,saveState(){saved.push(this.revision);}};
 f.scheduler.save(app);f.scheduler.save(app);assert.equal(f.frames.length,1);assert.deepEqual(saved,[]);
 f.frames.shift()();assert.deepEqual(saved,[]);
 app.revision=2;app.saveState();assert.deepEqual(saved,[2]); // existing pagehide/freeze path
 f.frames.shift()();assert.deepEqual(saved,[2]);
 app.revision=3;f.tasks.shift()();assert.deepEqual(saved,[2,3]);
 f.scheduler.save(app);assert.equal(f.frames.length,1);
});
test('hidden pages save immediately; owner proxies share one pending snapshot',()=>{
 const f=fixture(),raw={},saved=[],a={raw,saveState(){saved.push('a');}},b={raw,saveState(){saved.push('b');}};
 f.scheduler.save(a);f.scheduler.save(b);assert.equal(f.frames.length,1);
 f.document.visibilityState='hidden';f.scheduler.save(b);assert.deepEqual(saved,['b']);
 f.frames.shift()();f.frames.shift()();f.tasks.shift()();assert.deepEqual(saved,['b','a']);
});

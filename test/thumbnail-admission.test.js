import test from 'node:test';
import assert from 'node:assert/strict';
import { selectThumbnailAdmissions } from '../public/thumbnail-admission.js';

const row = overrides => [{ isConnected: true }, { near: true, visible: false, started: false, ...overrides }];

test('slow preloads retain their slots while one visible request uses the reserve', () => {
    const old = [row({started:true}), row({started:true})], visible = row({visible:true}), extra = row({visible:true});
    const selected = selectThumbnailAdmissions(new Map([...old, visible, extra]), 2);
    assert.deepEqual(selected, [visible]);
    assert.ok(old.every(([, state]) => state.started));
    assert.deepEqual(selectThumbnailAdmissions(new Map([extra]),3),[]);
});

test('visibility takes priority and offscreen preloads remain bounded to two', () => {
    const offscreen = row(), visible = row({visible:true}), second = row();
    assert.deepEqual(selectThumbnailAdmissions(new Map([offscreen,visible,second]),0),[visible,offscreen]);
    assert.deepEqual(selectThumbnailAdmissions(new Map([offscreen]),2),[]);
});

test('disconnected, out-of-range, and already-started images cannot be admitted twice', () => {
    const gone = [{isConnected:false},{near:true,visible:true}], far=row({near:false}), busy=row({started:true}), next=row();
    assert.deepEqual(selectThumbnailAdmissions(new Map([gone,far,busy,next]),1),[next]);
});

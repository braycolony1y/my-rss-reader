import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalViewCache} from '../src/articles/personal-view-cache.js';
test('navigation filtering reuses immutable input but invalidates personal edits, Undo and concurrent edits',async()=>{
    const state=hidden=>({hidden,rules:[],decisions:[]});
    const personal={state:state(false)},db={},articles=[{id:'a'}];let calls=0,concurrent=false;
    const filter=createPersonalViewCache({store:async()=>personal,filter:async(db,articles)=>{
        calls++;if(concurrent)personal.state=state(false);return personal.state.hidden?[]:articles;
    }});
    const get=()=>filter(db,articles,'tech_vietnam','view');
    assert.equal(await get(),articles);await get();assert.equal(calls,1);
    personal.state=state(true);assert.deepEqual(await get(),[]);assert.equal(calls,2);
    personal.state=state(false);assert.equal(await get(),articles);assert.equal(calls,3);
    await filter(db,[...articles],'tech_vietnam','view');assert.equal(calls,4);
    personal.state=state(true);concurrent=true;await get();await get();assert.equal(calls,6);
});

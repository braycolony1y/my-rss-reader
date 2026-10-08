import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('source timestamp formatter reuse preserves local relative and exact labels',()=>{
    const context=vm.createContext({Intl,Date});
    for(const name of ['source-time-format','presentation'])vm.runInContext(readFileSync(new URL(`../public/js/article/${name}.js`,import.meta.url),'utf8'),context);
    const app=vm.runInContext('ReaderArticlePresentation.create()',context);app.clockNow=new Date(2026,9,8,12).getTime();
    assert.equal(app.formatPostTime('invalid'),'');
    assert.equal(app.formatPostTime(app.clockNow),'Just now');
    assert.equal(app.formatPostTime(app.clockNow-60000),'1 minute ago');
    assert.equal(app.formatPostTime(app.clockNow-3600000),'1 hour ago');
    for(const days of [0,1,3,10]){
        const date=new Date(2026,9,8-days,8),time=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(date);
        const expected=days===0?`Today at ${time}`:days===1?`Yesterday at ${time}`:days<7?`${new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(date)} at ${time}`:new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric'}).format(date);
        assert.equal(app.formatPostTime(date),expected);
    }
    const element={dataset:{sourceTime:'2026-10-01T08:00:00Z',showExact:'true'},setAttribute(key,value){this[key]=value;}};
    app.updateSourceTimes({querySelectorAll:()=>[element]});
    const exact=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(element.dataset.sourceTime));
    assert.equal(element.textContent,exact);assert.equal(element.title,exact);assert.equal(element['aria-label'],exact);assert.equal(element['aria-expanded'],'true');
});

import {JSDOM} from 'jsdom';
import {readFile,writeFile} from 'node:fs/promises';
import {createReaderAssetRenderer} from '../../../src/ui/reader-assets.js';
const rows=[];
for(const variant of ['before','after']) {
 const dom=new JSDOM('<body></body>',{url:'https://reader.test',runScripts:'outside-only',pretendToBeVisual:true});
 const win=dom.window;win.fetch=async()=>({ok:true,json:async()=>({})});
 win.eval(variant==='before'?await readFile('/tmp/rss-flicker-20261014/before.js','utf8'):await createReaderAssetRenderer().script());
 const app=win.rssApp();app.selectedFilterType='smart';app.selectedFilterValue='news_vietnam';app.smartTabMode='top';app.articles=[{clusterId:'one',topStory:{material_version:1},briefing:{analysisStatus:'queued'}}];
 app.smartViewToken='view';let callback,resolve;
 win.setTimeout=fn=>{callback=fn;return 1;};win.clearTimeout=()=>{};
 win.fetch=async()=>({ok:true,json:()=>new Promise(r=>resolve=r)});
 app.scheduleBriefingRefresh(0,0);const pending=callback();await new Promise(r=>setImmediate(r));
 app.applyBriefingUpdates([{clusterId:'one',materialVersion:1,briefing:{analysisStatus:'evaluated',sections:[{text:'Completed'}]}}]);
 const pushed=app.articles[0].briefing;
 resolve({articles:[{clusterId:'one',topStory:{material_version:1},briefing:{analysisStatus:'queued',sections:[]}}]});
 await pending;rows.push({variant,pushedPreserved:app.articles[0].briefing===pushed,status:app.articles[0].briefing.analysisStatus});
 dom.window.close();
}
console.log(JSON.stringify(rows));await writeFile('/tmp/rss-flicker-20261014/briefing-race.json',JSON.stringify(rows,null,2));

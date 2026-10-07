// Isolated retained-heap probe; diagnostic GC only, never used by production.
import {writeFile} from 'node:fs/promises';
import {writeHeapSnapshot} from 'node:v8';
import {createPostSanitizer} from '../../../src/articles/post-markup-sanitizer.js';
const output=process.argv[2]||'/tmp/rss-audit-followup-20261007/sanitizer-retention.json';
const sanitizer=createPostSanitizer(),samples=[];
for(let cycle=0;cycle<12;cycle++){
 for(let i=0;i<400;i++)sanitizer.sanitizePostMarkup(`<div class="bbWrapper"><p>Post ${cycle}-${i}: ${'Representative forum article text. '.repeat(20)}</p><a href="https://example.test/${cycle}/${i}">source</a><img src="https://example.test/image-${i}.jpg"><blockquote>${'Quoted content. '.repeat(30)}</blockquote></div>`);
 await new Promise(r=>setImmediate(r));global.gc();
 const row={cycle,...process.memoryUsage(),cache:sanitizer.state()};samples.push(row);console.log(JSON.stringify(row));
 await writeFile(output,JSON.stringify(samples,null,2));
}
if(process.env.RSS_AUDIT_HEAP_SNAPSHOT==='1')console.log(writeHeapSnapshot(output+'.heapsnapshot'));

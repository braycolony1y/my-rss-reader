import fs from 'node:fs/promises';
import {exportLegacyOverlay} from '../../src/database/overlay-export.js';
let owner;
try{owner=JSON.parse(await fs.readFile('database.writer.lock','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(Number(owner?.pid)>0){let live=true;try{process.kill(Number(owner.pid),0);}catch(error){if(error.code==='ESRCH')live=false;else throw error;}if(live)throw Error('Stop rss-reader before exporting its state overlays.');}
for(const filename of ['database-state.json','smart-state.json'])console.log(filename,await exportLegacyOverlay(filename)?'converted to legacy format':'already legacy or absent');

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDatabaseStore} from '../src/database/store.js';

test('Smart metadata and rank updates preserve corpus files and recover through a later full publication', {timeout:15000}, async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rss-smart-incremental-')),previous=process.cwd();
    process.chdir(directory);
    try {
        const article={title:'Original',link:'https://example.test/one'};
        await fs.writeFile('database.json',JSON.stringify({articles:JSON.stringify([article]),feeds:'[]',topStoriesState:'{"old":true}'}));
        await fs.writeFile('smart-data.json',JSON.stringify({smartClusters:JSON.stringify([article]),topStoriesPublished:'{"old":true}'}));
        const db=createDatabaseStore().env.RSS_DATA;
        const mainBefore=await fs.readFile('database.json','utf8'),smartBefore=await fs.readFile('smart-data.json','utf8');
        await db.putMany({smartCandidateSignature:'new-signature',smartClusterState:'{"version":2}'});
        await db.put('topStoriesState','{"rank":2}');
        await db.put('topStoriesPublished','{"generation":2}');
        assert.equal(await fs.readFile('database.json','utf8'),mainBefore);
        assert.equal(await fs.readFile('smart-data.json','utf8'),smartBefore);
        let restarted=createDatabaseStore().env.RSS_DATA;
        assert.equal(await restarted.get('topStoriesState'),' {"rank":2}'.trim());
        assert.equal(await restarted.get('smartCandidateSignature'),'new-signature');
        assert.equal(await restarted.get('topStoriesPublished'),'{"generation":2}');
        await db.putMany({smartClusters:JSON.stringify([{...article,title:'Updated'}]),smartClusterVersion:'v3'});
        restarted=createDatabaseStore().env.RSS_DATA;
        assert.equal((await restarted.get('smartClusters',{type:'json'}))[0].title,'Updated');
        assert.equal(await restarted.get('topStoriesPublished'),'{"generation":2}');
        assert.equal(await restarted.get('smartClusterState'),'{"version":2}');
        assert.equal(await restarted.get('topStoriesState'),'{"rank":2}');
    } finally {process.chdir(previous);await fs.rm(directory,{recursive:true,force:true});}
});

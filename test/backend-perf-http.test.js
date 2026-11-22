import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import express from 'express';
import { createStaticTextAssets } from '../src/middleware/static-text-assets.js';
import { listJsonCompression } from '../src/middleware/json-compression.js';
import { createShellCompression } from '../src/middleware/shell-compression.js';
import { readResponseBytes } from '../src/fetch-response.js';
import { createConcurrencyLimiter } from '../src/runtime/concurrency-limiter.js';

async function server(t,app){const instance=app.listen(0,'127.0.0.1');await new Promise(resolve=>instance.once('listening',resolve));t.after(()=>new Promise(resolve=>instance.close(resolve)));return instance.address().port;}
function request(port,url,headers={},method='GET'){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:url,headers,method},response=>{const parts=[];response.on('data',b=>parts.push(b));response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(parts)}));}).once('error',reject);});}

test('static gzip/brotli negotiation, shared validators, immutable versions and component revalidation',async t=>{
    const directory=await fs.mkdtemp('/tmp/backend-assets-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    const body='const value="hello";\n'.repeat(4000);await fs.writeFile(path.join(directory,'app.js'),body);
    await fs.mkdir(path.join(directory,'components'));await fs.writeFile(path.join(directory,'components/card.html'),body);
    const app=express();app.use('/public',createStaticTextAssets({directory}),express.static(directory));const port=await server(t,app);
    const plain=await request(port,'/public/app.js'),gzip=await request(port,'/public/app.js?v=abc123',{'Accept-Encoding':'gzip'}),br=await request(port,'/public/app.js',{'Accept-Encoding':'br, gzip;q=0.5'});
    assert.equal(gunzipSync(gzip.body).toString(),body);assert.equal(brotliDecompressSync(br.body).toString(),body);
    assert.match(gzip.headers['cache-control'],/immutable/);assert.match(plain.headers['cache-control'],/no-cache/);
    assert.match(br.headers.vary,/Accept-Encoding/);assert.equal(br.headers.etag,plain.headers.etag);
    assert.ok(br.headers['last-modified']);
    const cached=await request(port,'/public/app.js',{'If-None-Match':br.headers.etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
    const head=await request(port,'/public/app.js',{'If-Modified-Since':br.headers['last-modified']});assert.equal(head.status,304);
    const component=await request(port,'/public/components/card.html?v=abc123');assert.match(component.headers['cache-control'],/no-cache/);
    await fs.writeFile(path.join(directory,'app.js'),body+'changed');const changed=await request(port,'/public/app.js',{'If-None-Match':br.headers.etag});assert.equal(changed.status,200);assert.notEqual(changed.headers.etag,br.headers.etag);
    const refused=await request(port,'/public/app.js',{'Accept-Encoding':'gzip;q=0, br;q=0, identity'});assert.equal(refused.headers['content-encoding'],undefined);
    assert.equal((await request(port,'/public/app.js',{'Accept-Encoding':'gzip;q=0, br;q=0, identity;q=0'})).status,406);
    const range=await request(port,'/public/app.js',{Range:'bytes=0-9'});assert.equal(range.status,206);assert.equal(range.body.toString(),body.slice(0,10));
    const headOnly=await request(port,'/public/app.js',{'Accept-Encoding':'br'},'HEAD');assert.equal(headOnly.body.length,0);assert.equal(headOnly.headers['content-encoding'],'br');
});

test('JSON compression covers other APIs and leaves event streams and no-transform alone',async t=>{
    const app=express();app.use(listJsonCompression);const data={text:'abcdef'.repeat(10000)};
    app.get('/api/user-states',(req,res)=>res.json(data));app.get('/api/plain',(req,res)=>{res.set('Cache-Control','no-transform');res.json(data);});
    app.get('/api/events',(req,res)=>res.type('text/event-stream').send('data: '+data.text));
    const port=await server(t,app);
    const gzip=await request(port,'/api/user-states',{'Accept-Encoding':'gzip'}),br=await request(port,'/api/user-states',{'Accept-Encoding':'br'});
    assert.deepEqual(JSON.parse(gunzipSync(gzip.body)),data);assert.deepEqual(JSON.parse(brotliDecompressSync(br.body)),data);
    for(const url of ['/api/plain','/api/events'])assert.equal((await request(port,url,{'Accept-Encoding':'gzip'})).headers['content-encoding'],undefined);
    const cached=await request(port,'/api/user-states',{'Accept-Encoding':'gzip','If-None-Match':gzip.headers.etag});assert.equal(cached.status,304);
    assert.equal((await request(port,'/api/user-states',{'Accept-Encoding':'gzip;q=0, br;q=0, identity;q=0'})).status,406);
    const head=await request(port,'/api/user-states',{'Accept-Encoding':'gzip'},'HEAD');assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],gzip.headers['content-length']);assert.equal(head.headers['content-encoding'],'gzip');
});

test('shell refuses unavailable representations and compresses small bodies when identity is forbidden',async t=>{
    const app=express();app.use(createShellCompression());app.get('/',(req,res)=>res.send('small shell'));
    const port=await server(t,app);
    assert.equal((await request(port,'/',{'Accept-Encoding':'gzip;q=0, br;q=0, identity;q=0'})).status,406);
    const compressed=await request(port,'/',{'Accept-Encoding':'gzip, identity;q=0'});assert.equal(gunzipSync(compressed.body).toString(),'small shell');
});

test('decoded response byte limits cancel oversized streams, with and without Content-Length',async()=>{
    for(const headers of [{},{'Content-Length':'1000'}]){
        let cancelled=false;const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(64));},cancel(){cancelled=true;}});
        await assert.rejects(readResponseBytes(new Response(stream,{headers}),{maxBytes:100}),{code:'RESPONSE_TOO_LARGE'});assert.equal(cancelled,true);
    }
    assert.equal((await readResponseBytes(new Response('small'),{maxBytes:100})).toString(),'small');
});

test('bounded queue rejects excess work and releases capacity after success or failure',async()=>{
    const limiter=createConcurrencyLimiter(1,{maxPending:1});let release;
    const running=limiter.run(()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
    const pending=limiter.run(()=>{throw Error('expected');});
    await assert.rejects(limiter.run(()=>null),{code:'WORK_QUEUE_FULL'});release();await running;await assert.rejects(pending,/expected/);
    assert.equal(await limiter.run(()=>42),42);
});

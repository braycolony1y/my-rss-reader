import { createReadStream, openSync, writeSync, closeSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { createTokenWriter } from './token-writer.js';
const require = createRequire(import.meta.url);
const { parser } = require('stream-json');
const StreamArray = require('stream-json/streamers/StreamArray');
const StreamObject = require('stream-json/streamers/StreamObject');

// Spill one decoded top-level value at a time. Legacy snapshots double-encode
// large arrays as strings; packing those strings would defeat streaming.
export async function* legacyFields(filename, directory) {
    await mkdir(directory,{recursive:true,mode:0o700});
    const tokens = parser({packValues:false,packKeys:true,streamKeys:false});
    const task = pipeline(createReadStream(filename),tokens).catch(error=>{ tokens.destroy(error); });
    let depth = 0, key, capture, sequence = 0;
    const flush = () => { if (capture.batch) { writeSync(capture.fd,capture.batch,null,capture.string?'utf16le':'utf8'); capture.batch=''; } };
    const append = chunk => { capture.batch += chunk; if(capture.batch.length>=65536) flush(); };
    try {
        for await (const token of tokens) {
            if (!capture && token.name === 'keyValue' && depth === 1) { key = token.value; continue; }
            if (!capture && key !== undefined) {
                const file = path.join(directory,`${sequence++}.value`), string = token.name === 'startString';
                capture={key,file,string,fd:openSync(file,'w',0o600),batch:'',startDepth:depth};
                if (!string) {
                    capture.stringer = createTokenWriter(append);
                }
            }
            if (capture) {
                if (capture.string) { if(token.name==='stringChunk') append(token.value); }
                else capture.stringer(token);
            }
            if (token.name==='startObject'||token.name==='startArray') depth++;
            if (token.name==='endObject'||token.name==='endArray') depth--;
            const done = capture && (capture.string ? token.name==='endString' :
                depth===capture.startDepth && ['endObject','endArray','endNumber','trueValue','falseValue','nullValue'].includes(token.name));
            if (done) {
                flush();closeSync(capture.fd);capture.fd=null;
                const field={key:capture.key,file:capture.file,string:capture.string};
                capture=null;key=undefined;
                try { yield field; } finally { await rm(field.file,{force:true}); }
            }
        }
        await task;
        if (depth!==0 || capture) throw Error('Incomplete legacy JSON snapshot');
    } finally {
        if(capture?.fd!=null)closeSync(capture.fd);
        tokens.destroy();await task;
    }
}

export async function* fieldEntries(field, shape) {
    const stream = new PassThrough({objectMode:true});
    const task = pipeline(createReadStream(field.file,{encoding:field.string?'utf16le':'utf8'}),parser(),shape==='array'?new StreamArray():new StreamObject(),stream)
        .catch(error=>stream.destroy(error));
    try { for await(const entry of stream) yield entry; await task; }
    finally { stream.destroy();await task; }
}

export async function fieldShape(field) {
    const {open} = await import('node:fs/promises');
    const file = await open(field.file,'r');
    let prefix;try { const buffer=Buffer.alloc(256);const result=await file.read(buffer,0,256,0);prefix=buffer.subarray(0,result.bytesRead).toString(field.string?'utf16le':'utf8').trimStart(); }finally{await file.close();}
    return prefix.startsWith('[')?'array':prefix.startsWith('{')?'object':'scalar';
}
export async function scalarField(field) {
    const text=await readFile(field.file,field.string?'utf16le':'utf8');
    return field.string?text:JSON.parse(text);
}

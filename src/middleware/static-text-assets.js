import path from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
const gzipAsync=promisify(gzip),brotliAsync=promisify(brotliCompress);

export function assetCacheControl(req, component = false) {
    if (component) return 'no-cache, must-revalidate';
    const version = new URL(req.originalUrl || req.url, 'http://assets.local').searchParams.get('v');
    return version ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate';
}
// Textual assets only. Images/fonts/video and oversized files retain Express's
// streaming path. Memory includes source and both compressed variants; concurrent
// requests share their compression promise, with a 16 MiB total LRU budget.
export function createStaticTextAssets({ directory = path.resolve('public'), maxBytes = 16 * 1024 * 1024 } = {}) {
    directory=path.resolve(directory);
    const cache=new Map();let bytes=0;
    function evict(){while(bytes>maxBytes && cache.size){const [key,row]=cache.entries().next().value;cache.delete(key);bytes-=row.bytes;}}
    return async (req,res,next)=>{
        if (!['GET','HEAD'].includes(req.method) || req.headers.range) return next();
        let relative;try{relative=decodeURIComponent(req.path);}catch{return next();}
        if(!/\.(?:js|css|html|json|txt)$/i.test(relative))return next();
        const filename=path.resolve(directory,'.'+relative);
        if(!filename.startsWith(directory+path.sep)||relative.split('/').some(part=>part.startsWith('.')))return next();
        try{
            const info=await stat(filename);
            if(!info.isFile()||info.size>2*1024*1024)return next();
            const version=info.mtimeMs+':'+info.ctimeMs+':'+info.size;
            let row=cache.get(filename);
            if(row?.version!==version){
                if(row){cache.delete(filename);bytes-=row.bytes;}
                // Publish the in-flight load too, avoiding a read per concurrent request.
                row={version,bytes:info.size,encodings:new Map()};
                row.body=readFile(filename);row.etag=row.body.then(body=>'W/"'+createHash('sha256').update(body).digest('base64url')+'"');
                cache.set(filename,row);bytes+=row.bytes;evict();
            }else{cache.delete(filename);cache.set(filename,row);}
            res.type(path.extname(filename));res.vary('Accept-Encoding');
            res.set('Cache-Control',assetCacheControl(req,relative.startsWith('/components/')));
            res.set('Last-Modified',info.mtime.toUTCString());res.set('ETag',await row.etag);
            if(req.fresh)return res.status(304).end();
            const body=await row.body;
            const accepted=req.acceptsEncodings('br','gzip','identity');
            if(!accepted)return res.status(406).end();
            if((body.length<1024&&req.acceptsEncodings('identity'))||accepted==='identity')return res.send(body);
            if(!row.encodings.has(accepted)){
                const promise=accepted==='br'?brotliAsync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):gzipAsync(body,{level:4});
                row.encodings.set(accepted,promise);
                promise.then(buffer=>{if(cache.get(filename)===row){row.bytes+=buffer.length;bytes+=buffer.length;evict();}},()=>{row.encodings.delete(accepted);});
            }
            res.set('Content-Encoding',accepted);return res.send(await row.encodings.get(accepted));
        }catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))return next(error);return next();}
    };
}

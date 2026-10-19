import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function startScrollFixture(root, {count=40,imageDelay=50,focusDelay=20,pageSize=0}={}) {
    const {createReaderAssetRenderer}=await import(pathToFileURL(root+'/src/ui/reader-assets.js'));
    const {createFixtureApi,articles}=await import(pathToFileURL(root+'/test/helpers/frontend-refactor/fixtures.js'));
    const renderer=createReaderAssetRenderer(),api=createFixtureApi(),bytes=await readFile(root+'/public/default.jpg');
    const network={active:0,peak:0,requests:[]};
    const server=http.createServer(async(req,res)=>{
        const url=new URL(req.url,'http://localhost');
        try {
            if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': fixture\n\n');return;}
            if(url.pathname==='/api/og-image'){
                const started=performance.now();network.active++;network.peak=Math.max(network.peak,network.active);
                const record={source:url.search,started};network.requests.push(record);
                res.once('close',()=>{network.active--;record.closed=performance.now();record.complete=res.writableFinished;});
                await new Promise(r=>setTimeout(r,imageDelay));
                res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private,max-age=86400','Timing-Allow-Origin':'*'});res.end(bytes);return;
            }
            if(url.pathname==='/api/image-focus'){
                await new Promise(r=>setTimeout(r,focusDelay));res.setHeader('Content-Type','application/json');
                res.end(JSON.stringify({x:.65,y:.45,type:'saliency'}));return;
            }
            if(url.pathname.startsWith('/api/')){
                let body='';for await(const chunk of req)body+=chunk;
                let value=api(url,body?JSON.parse(body):{});
                if(url.pathname==='/api/data'){
                    const feed=url.searchParams.get('filterType')==='feed',list=Array.from({length:count},(_,i)=>({...articles[i%8],id:`scroll-${i}`,link:`https://example.test/scroll-${i}`,clusterId:`scroll-${i}`,title:`Story ${i+1}: ${articles[i%8].title}`,image:`/api/og-image?url=https%3A%2F%2Fexample.test%2Fphoto-${i}`,topStory:{...articles[i%8].topStory,rank:i+1},...(feed?{briefing:null,isCluster:false,relatedArticles:[],sourceCount:1}:{})}));
                    const start=pageSize?Math.max(0,(Number(url.searchParams.get('page'))||1)-1)*pageSize:0;
                    const page=pageSize?list.slice(start,start+pageSize):list;
                    value={...value,articles:page,topStories:page,hasMore:pageSize?start+pageSize<list.length:false};
                }
                res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
            }
            if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(await renderer.html());return;}
            if(url.pathname==='/script.js'){res.setHeader('Content-Type','text/javascript');res.end(await renderer.script());return;}
            if(url.pathname.startsWith('/public/')){
                const file=path.resolve(root,'.'+url.pathname);
                if(!file.startsWith(path.join(root,'public')+path.sep))throw Error('Invalid path');
                const types={'.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.svg':'image/svg+xml','.png':'image/png'};
                res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));return;
            }
            res.writeHead(404).end();
        }catch(error){res.writeHead(500).end(error.message);}
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    return {url:`http://127.0.0.1:${server.address().port}`,network,close(){server.closeAllConnections();server.close();}};
}

// Request boundaries complement route-level Server-Timing phases. Wall-clock
// timestamps permit correlation with browser traces; durations are monotonic.
import {traceDatabaseReads,databaseReadTimings} from '../database/read-timing.js';
export function listTiming(req,res,next) {
    const entered=performance.now();
    res.setHeader('X-Reader-Received-At',String(Date.now()));
    const send=res.send.bind(res);
    res.send=body=>{
        if(!res.headersSent) {
            const existing=res.getHeader('Server-Timing');
            res.setHeader('Server-Timing',[existing,databaseReadTimings(),`origin;dur=${(performance.now()-entered).toFixed(3)}`].filter(Boolean).join(', '));
        }
        return send(body);
    };
    if(req.headers?.['x-reader-trace']==='1')return traceDatabaseReads(next);
    next();
}

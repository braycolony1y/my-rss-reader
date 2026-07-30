const { env } = require('./server.js');
async function run() {
    const readStates = await env.RSS_DATA.get('readStates', { type: 'json' }) || [];
    console.log('ReadStates count:', readStates.length);
    console.log('Last 5 readStates:', readStates.slice(-5));
    
    const allArticles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
    console.log('AllArticles count:', allArticles.length);
    
    const lastRead = readStates[readStates.length - 1];
    const foundInArticles = allArticles.find(a => a.link === lastRead);
    console.log('Last read article found in allArticles:', !!foundInArticles);
    
    process.exit(0);
}
setTimeout(run, 2000);

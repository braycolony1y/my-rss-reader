import BBCSource from './src/sources/BBCSource.js';
import https from 'https';

https.get('https://www.bbc.co.uk/news/articles/cy8mynlmn55o', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', async () => {
        const source = new BBCSource();
        const result = await source.parse('https://www.bbc.co.uk/news/articles/cy8mynlmn55o', data, 'https://www.bbc.co.uk/');
        console.log("Title:", result.title);
        console.log("Related count:", result.related.length);
        console.log("Content size:", result.content.length);
        console.log("First 3 related:", result.related.slice(0, 3));
    });
});

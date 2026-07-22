const cheerio = require('cheerio');
const https = require('https');
https.get('https://www.bbc.co.uk/news/articles/cy8mynlmn55o', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const $ = cheerio.load(data);
        
        // Find H2 "Related topics"
        const moreHeading = $('h2').filter((i, el) => $(el).text().toLowerCase().includes('related topics'));
        if (moreHeading.length > 0) {
            console.log("Found 'Related topics'. Parent HTML:");
            console.log(moreHeading.parent().parent().html().substring(0, 500));
        }
    });
});

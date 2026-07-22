const fetch = require('node-fetch');

async function testFetch(url) {
    try {
        const response = await fetch(url);
        console.log(`${url} - Status: ${response.status}`);
        const text = await response.text();
        console.log(`Length: ${text.length}`);
        console.log(`Preview: ${text.substring(0, 100)}`);
    } catch (e) {
        console.log(`${url} - Error: ${e.message}`);
    }
}

testFetch('https://voz.vn/f/chuyen-tro-linh-tinh-tm.17/index.rss');
testFetch('https://kenh14.vn/home.rss');

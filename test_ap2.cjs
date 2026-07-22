const fs = require('fs');
(async () => {
    const { cleanAndExtractArticle } = require('./test_clean.js');
    const result = await cleanAndExtractArticle('https://apnews.com/article/tate-brothers-social-influencers-arrest-82b6638219839dcf653c09309da66f16');
    fs.writeFileSync('apnews_result.md', result.markdown);
})();

const fs = require('fs');
const html = fs.readFileSync('/dev/stdin', 'utf-8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
console.log('Inline related articles:');
$('.VCSortableInPreviewMode').each((i, el) => {
    console.log("Found:", $(el).attr('type'));
    if ($(el).attr('type') === 'RelatedOneNews') {
        console.log($.html(el));
    }
    if ($(el).attr('type') === 'WrapNote') {
        console.log($.html(el));
    }
});

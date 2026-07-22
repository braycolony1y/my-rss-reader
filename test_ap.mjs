import { extract } from '@extractus/article-extractor';
import fs from 'fs';

const html = fs.readFileSync('apnews.html', 'utf8');
const result = await extract(html, 'https://apnews.com/article/tate-brothers-social-influencers-arrest-82b6638219839dcf653c09309da66f16');
console.log("Title:", result.title);
console.log("Author:", result.author);
console.log("Published:", result.published);
console.log("Image:", result.image);
console.log("Content length:", result.content?.length);

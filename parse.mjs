import fs from 'fs';
import * as cheerio from 'cheerio';
const html = fs.readFileSync('/tmp/danviet.html', 'utf8');
const $ = cheerio.load(html);

console.log('Body:', $('.entry-body').text().trim().substring(0, 500));

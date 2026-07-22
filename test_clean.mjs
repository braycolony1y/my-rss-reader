import fs from 'fs/promises';
import { cleanArticleMarkup } from './server.js';
const file = await fs.readFile('article_cache/37be4c4e172c542d78bb7761852041b8650dbdfc96c00299c9a7228a8c3f6925.json', 'utf-8');
const data = JSON.parse(file);
const cleaned = cleanArticleMarkup(data.result.content);
console.log("Original contains BÀI VIẾT LIÊN QUAN:", data.result.content.includes("BÀI VIẾT LIÊN QUAN"));
console.log("Cleaned contains BÀI VIẾT LIÊN QUAN:", cleaned.includes("BÀI VIẾT LIÊN QUAN"));
console.log("Cleaned length:", cleaned.length);

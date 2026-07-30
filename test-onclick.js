import fs from 'fs';
import TuoitreSource from './src/sources/TuoitreSource.js';
const html = fs.readFileSync('/tmp/tuoitre.html', 'utf8');

const source = new TuoitreSource();
const resultHtml = source.parseArticleHtmlContent(html, 'https://tuoitre.vn/...', {}, {});

function cleanArticleMarkup(markup) {
    let cleaned = String(markup || '');
    // simplified
    cleaned = cleaned.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
    const badAttributes = /\b(?:on(?:click|load|mouseover|mouseout|mouseenter|mouseleave|keydown|keyup|keypress|change|submit|focus|blur|dblclick|drag|dragstart|dragend|drop|scroll|resize|contextmenu|pointerdown|pointerup|touchstart|touchend|touchmove)|style)=["'][^"']*["']/gi;
    cleaned = cleaned.replace(badAttributes, '');
    return cleaned;
}

const cleaned = cleanArticleMarkup(resultHtml);
console.log(cleaned.includes('onclick'));

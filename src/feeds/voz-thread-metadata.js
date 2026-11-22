import { load } from 'cheerio';
import { absoluteTimestamp } from '../articles/source-time.js';
import { parseK } from './source-parsers.js';

// The forum listing carries the original thread date separately from the
// latest-reply date. Read only the starter metadata, never the latest cell.
export function extractVozThreadListMetadata(html) {
    const $ = load(String(html || ''));
    const threads = new Map();

    $('.structItem[class*="js-threadListItem-"]').each((_, element) => {
        const row = $(element);
        const id = (row.attr('class') || '').match(/\bjs-threadListItem-(\d+)\b/)?.[1];
        if (!id || row.hasClass('structItem--sticky') || row.find('.structItem-status--sticky').length) return;

        const startTime = row.find('.structItem-startDate time').first();
        const authorTime = row.find('.structItem-cell--main .structItem-minor time').first();
        const createdAt = absoluteTimestamp((startTime.length ? startTime : authorTime).attr('datetime'));

        // Counts are optional. A markup change to replies/views must not
        // discard a valid original-creation timestamp.
        const pairs = row.find('.structItem-cell--meta dl.pairs');
        const replyText = pairs.first().find('dd').first().text().trim();
        const viewText = row.find('.structItem-cell--meta dl.pairs.structItem-minor dd').first().text().trim()
            || pairs.eq(1).find('dd').first().text().trim();
        const count = raw => /^\d[\d,.]*[KM]?$/i.test(raw) ? parseK(raw) : null;
        const replies = count(replyText);
        const views = count(viewText);

        if (createdAt || replies !== null || views !== null) {
            threads.set(id, { createDate: createdAt, replies, views });
        }
    });

    return threads;
}

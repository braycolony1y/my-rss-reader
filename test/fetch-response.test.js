import test from 'node:test';
import assert from 'node:assert/strict';

import { createTrackedFetch, discardResponseBody } from '../src/fetch-response.js';

test('discardResponseBody cancels an unread web response body', async () => {
    let cancellations = 0;
    const response = {
        bodyUsed: false,
        body: {
            async cancel() {
                cancellations += 1;
            }
        }
    };

    assert.equal(await discardResponseBody(response), true);
    assert.equal(cancellations, 1);
});

test('discardResponseBody leaves consumed responses alone', async () => {
    let cancellations = 0;
    const response = {
        bodyUsed: true,
        body: {
            async cancel() {
                cancellations += 1;
            }
        }
    };

    assert.equal(await discardResponseBody(response), false);
    assert.equal(cancellations, 0);
});

test('createTrackedFetch releases every unread response returned by a handler', async () => {
    let cancellations = 0;
    const unread = {
        bodyUsed: false,
        body: { async cancel() { cancellations += 1; } }
    };
    const consumed = {
        bodyUsed: true,
        body: { async cancel() { cancellations += 1; } }
    };
    const responses = [unread, consumed];
    const tracked = createTrackedFetch(async () => responses.shift());

    await tracked.fetch('https://example.com/unread');
    await tracked.fetch('https://example.com/consumed');
    await tracked.discardUnread();

    assert.equal(cancellations, 1);
});

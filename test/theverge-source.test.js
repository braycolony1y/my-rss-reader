import assert from 'node:assert/strict';
import test from 'node:test';
import TheVergeSource, { cleanTheVergeReaderMarkdown } from '../src/sources/TheVergeSource.js';

const markdown = `
# Google Pics is a new AI image editor

Google announced an image editor that creates new pictures from prompts.

Google announced an image editor that creates new pictures from prompts.

by Jess Weatherbed

![Google image editor](https://platform.theverge.com/wp-content/uploads/sites/2/2026/09/google-pics.jpg)

![Google image editor](https://platform.theverge.com/wp-content/uploads/sites/2/2026/09/google-pics.jpg)

_Google wants its new editor to be easier to use._
Image: Google

![Jess Weatherbed](https://platform.theverge.com/wp-content/uploads/sites/2/author_profile_images/jess.jpg)

Jess Weatherbed is a news writer covering creative tools for The Verge and started her career in design.

Google has a new suite of generative image tools that lets people combine photos, edit individual objects, and create images from text prompts without leaving the editor.

The company says the feature will begin rolling out today, with more controls arriving later this year for professional users.

[Subscribe to The Verge](https://www.theverge.com/subscribe)

## Most Popular
`;

test('The Verge reader cleanup uses the publisher handler for Techmeme primary articles', () => {
    const source = new TheVergeSource();
    const cleaned = cleanTheVergeReaderMarkdown(markdown);
    assert.equal(source.match('www.theverge.com'), true);
    assert.equal(cleaned.author, 'Jess Weatherbed');
    assert.match(cleaned.image, /google-pics\.jpg/);
    assert.equal(cleaned.imageCaption, 'Google wants its new editor to be easier to use. · Image: Google');
    assert.match(cleaned.markdown, /^Google has a new suite/m);
    assert.doesNotMatch(cleaned.markdown, /author_profile_images|Subscribe|Most Popular|Google announced/);
});

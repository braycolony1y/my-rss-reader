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

test('The Verge reader skips a byline profile photo before the real hero image', () => {
    const cleaned = cleanTheVergeReaderMarkdown(`
# Mozilla launches ad blocking for Firefox on iOS

Mozilla is using Apple’s WebKit Content Blocker technology and the EasyList filter.

by Tom Warren

![Image 3: Tom Warren](https://platform.theverge.com/wp-content/uploads/sites/2/2025/01/Tom_BLURPLE.jpg?w=2400)

Tom Warren

Senior Correspondent

![Image 4: Firefox](https://platform.theverge.com/wp-content/uploads/sites/2/2026/02/firefox.jpg?w=2400)

![Image 5: Firefox](https://platform.theverge.com/wp-content/uploads/sites/2/2026/02/firefox.jpg?w=2400)

Image: The Verge

![Image 6: Tom Warren](https://platform.theverge.com/wp-content/uploads/sites/2/2025/01/Tom_BLURPLE.jpg?w=96)

Tom Warren is a senior correspondent and author of Notepad, who has been covering all things Microsoft, PC, and technology for more than 20 years.

Mozilla is officially launching ad blocking for Firefox on iOS today, after testing the feature over the past few weeks. The option blocks most third-party ads and trackers before they load.

Mozilla is using Apple’s WebKit Content Blocker technology and EasyList, and keeps the feature disabled by default until the user enables it.

[Subscribe to The Verge](https://www.theverge.com/subscribe)
`);

    assert.match(cleaned.image, /firefox\.jpg/);
    assert.equal(cleaned.imageCaption, 'Image: The Verge');
    assert.match(cleaned.markdown, /^Mozilla is officially launching/m);
    assert.doesNotMatch(cleaned.markdown, /Tom_BLURPLE|Senior Correspondent|covered technology/);
});

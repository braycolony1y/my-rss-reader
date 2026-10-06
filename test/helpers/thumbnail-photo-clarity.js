import assert from 'node:assert/strict';
import sharp from 'sharp';

// Compare an unobstructed right-hand region to the identical source crop with
// masks removed. Geometry and object-position remain unchanged in the reference.
export async function verifyThumbnailClarity(page, card) {
    const clip = await card.evaluate(node => {
        const bounds = node.getBoundingClientRect(), image = node.querySelector('.thumbnail-img').getBoundingClientRect();
        return { x: Math.ceil(bounds.left + bounds.width * .86), y: Math.ceil(image.top + image.height * .25),
            width: Math.floor(bounds.width * .08), height: Math.floor(image.height * .12) };
    });
    const actual = await page.screenshot({ clip });
    const override = await page.addStyleTag({ content: '.thumbnail-clarity-reference .thumbnail-img {mask-image:none!important;-webkit-mask-image:none!important} .thumbnail-clarity-reference .thumbnail-soft {visibility:hidden!important}' });
    let reference;
    try {
        await card.evaluate(node => node.classList.add('thumbnail-clarity-reference'));
        reference = await page.screenshot({ clip });
    } finally {
        await card.evaluate(node => node.classList.remove('thumbnail-clarity-reference'));
        await override.evaluate(node => node.remove());
    }
    const [a, b] = await Promise.all([actual, reference].map(buffer => sharp(buffer).removeAlpha().raw().toBuffer()));
    assert.equal(a.length, b.length);
    const difference = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
    assert.ok(difference < 1, `Sharp photo pixels differ from the source crop by ${difference}/255`);
    return { clip, meanPixelDifference: difference };
}

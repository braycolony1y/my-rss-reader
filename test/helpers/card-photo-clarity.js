import assert from 'node:assert/strict';
import sharp from 'sharp';

// Compare the requested clear rectangle with the exact same cover crop rendered
// without fades, blur copies or tint lift. This catches stacked haze layers.
export async function verifyClearPhotoRegion(page) {
    const override = await page.addStyleTag({ content: `
        .qa-original-photo .thumbnail-plate,
        .qa-original-photo .article-card-image img.thumbnail-img {
            mask-image: none !important; -webkit-mask-image: none !important;
        }
        .qa-original-photo .article-card-image img.thumbnail-soft { visibility: hidden !important; }
        
    ` });
    try {
        for (const card of await page.$$('.article-card')) {
            const { clip, mode } = await card.evaluate(el => {
                const header = el.querySelector('.article-card-image');
                const h = header.getBoundingClientRect();
                const fy = el.dataset.blendBottom === 'true' ? parseFloat(getComputedStyle(el).getPropertyValue('--fy')) : 0;
                const x = Math.ceil(h.x + h.width * .68);
                const y = Math.ceil(h.y + scrollY + 24);
                return { mode: el.dataset.mode, clip: { x, y,
                    width: Math.floor(h.right - 28 - x),
                    height: Math.floor(h.bottom + scrollY - fy - 2 - y) } };
            });
            if (clip.height < 1) continue;
            const actual = await page.screenshot({ clip });
            await card.evaluate(el => el.classList.add('qa-original-photo'));
            const original = await page.screenshot({ clip });
            await card.evaluate(el => el.classList.remove('qa-original-photo'));
            assert.ok((await sharp(actual).raw().toBuffer()).equals(await sharp(original).raw().toBuffer()),
                `${mode}: clear part of the thumbnail matches the harmonized sharp photo pixel for pixel`);
        }
    } finally { await override.evaluate(el => el.remove()); }
}

import sharp from 'sharp';

const luminance = rgb => rgb.map(v => {
    const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);

export async function paintedCardTextContrast(card, clip, actual, background) {
    const text = await card.evaluate((card, clip) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        return ['h2', '.article-card-heading p'].map(selector => {
            const node = card.querySelector(selector), rect = node.getBoundingClientRect();
            context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(node).color;
            context.fillRect(0, 0, 1, 1);
            return { selector, x: rect.x - clip.x, y: rect.y - clip.y, width: rect.width, height: rect.height,
                color: [...context.getImageData(0, 0, 1, 1).data] };
        });
    }, clip);
    const decode = buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [visible, hidden] = await Promise.all([decode(actual), decode(background)]);
    return text.map(rect => {
        let minimum = Infinity, samples = 0;
        for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(hidden.info.height, rect.y + rect.height); y++)
            for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(hidden.info.width, rect.x + rect.width); x++) {
                const i = (y * hidden.info.width + x) * 3;
                if (Math.max(...[0, 1, 2].map(c => Math.abs(visible.data[i + c] - hidden.data[i + c]))) < 30) continue;
                const bg = [...hidden.data.slice(i, i + 3)], alpha = rect.color[3] / 255;
                const foreground = luminance(rect.color.slice(0, 3).map((v, c) => v * alpha + bg[c] * (1 - alpha)));
                const surface = luminance(bg);
                minimum = Math.min(minimum, (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05));
                samples++;
            }
        return { selector: rect.selector, minimum, samples };
    });
}

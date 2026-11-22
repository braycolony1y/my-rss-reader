// Decode generated inline assets before committing their metadata. There are no
// new network requests and no global strong image registry. Failures retain the
// source photograph and valid focus instead of presenting a broken baked asset.
export async function prepareImageVisualAssets(metadata, win) {
    if (!metadata || !Number.isFinite(metadata.x) || !Number.isFinite(metadata.y)) throw new Error('Invalid image metadata');
    const slots = [
        [metadata.blend, 'ambientImage'], [metadata.blend, 'meltImage'],
        [metadata.blend?.story?.assets, 'ambientImage'], [metadata.blend?.story?.assets, 'heroImage'],
        [metadata.topStoryBlend?.assets, 'ambientImage'], [metadata.topStoryBlend?.assets, 'heroImage']
    ].filter(([owner, key]) => typeof owner?.[key] === 'string' && owner[key].startsWith('data:image/'));
    if (!slots.length) return metadata;
    const failed = new Set();
    await Promise.all([...new Set(slots.map(([owner, key]) => owner[key]))].map(async source => {
        const image = new win.Image();
        let timer;
        try {
            image.src = source;
            await Promise.race([image.decode(), new Promise((_, reject) => {
                timer = win.setTimeout(() => reject(new Error('Asset decode timeout')), 2500);
            })]);
        } catch { failed.add(source); }
        finally { win.clearTimeout(timer); }
    }));
    if (!failed.size) return metadata;
    const clean = value => {
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) =>
            [key, typeof item === 'string' && failed.has(item) ? '' : key === 'assets' || key === 'story' ? clean(item) : item]));
    };
    return { ...metadata, blend: clean(metadata.blend), topStoryBlend: clean(metadata.topStoryBlend) };
}

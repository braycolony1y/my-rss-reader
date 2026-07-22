const isInvalidImage = (url) => {
    if (!url || typeof url !== 'string' || url === 'null') return true;
    const lower = url.trim().toLowerCase();
    if (/^\d+$/.test(lower) || lower === 'image/jpeg' || lower === 'image/jpg' || lower === 'image/png' || lower === 'image/webp' || lower === 'image/gif') return true;
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('/') && !lower.startsWith('data:image')) return true;
    if (/\/zoom\/\d+_\d+\//.test(lower) || /\/thumb_\d+_\d+\//.test(lower) || lower.includes('/36_36/') || lower.includes('/48_48/') || lower.includes('/60_60/') || lower.includes('/80_80/')) return true;
    return lower.includes('logo') || (lower.includes('avatar') && !/avatar\d{10}/.test(lower)) || lower.includes('author_default') || lower.includes('default_avatar') ||
        lower.includes('default-image') || lower.includes('default_image') || lower.includes('no-image') ||
        lower.includes('default.png') || lower.includes('default.jpg') || lower.includes('tto_default_avatar') ||
        lower.includes('tpo_social_share') || lower.includes('user-gray') || lower.includes('spinner') ||
        lower.includes('blank.gif') || lower.includes('smilie') || lower.includes('emoji') ||
        lower.includes('twemoji') || lower.includes('apple.com') || lower.startsWith('data:image') ||
        lower.includes('banner_gg_news') || lower.includes('/banner') || lower.includes('avplayer.com');
};
console.log(isInvalidImage('https://photo.znews.vn/w1250/Uploaded/mfnuy/2026_07_20/cucu_er_1.jpg'));

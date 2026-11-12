// Keep bounded VOZ image display hints while removing publisher layout styles.
// Other article sources continue to use the reader's responsive dimensions.
export function cleanResponsiveDimensions(node, { protectedNode = false, mediaNode = false, vozPost = false } = {}) {
    if (protectedNode || (mediaNode && node[0]?.tagName !== 'img')) return;
    const width = node.attr('width');
    const preserveWidth = vozPost && node[0]?.tagName === 'img'
        && node.closest('.voz-post').length > 0
        && /^\d+$/.test(width || '') && Number(width) >= 1 && Number(width) <= 4096;
    node.removeAttr('style height min-height max-height width');
    if (preserveWidth) node.attr('width', width);
}

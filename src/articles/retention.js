export const CONTENT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export function deletionTime(meta) {
    return Date.parse(meta.deletedDetectedAt || '') || meta.cachedAt || 0;
}
export function archiveExpiry(member) {
    if (member?.retention_protected) return Infinity;
    if (member?.left_cache_at) return Date.parse(member.left_cache_at) + CONTENT_RETENTION_MS;
    const deadlines = [];
    if (member?.source_removed && member.removed_at) deadlines.push(Date.parse(member.removed_at) + CONTENT_RETENTION_MS);
    return deadlines.length ? Math.min(...deadlines) : Infinity;
}

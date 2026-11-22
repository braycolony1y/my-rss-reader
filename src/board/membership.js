export function createMembershipReconciler({ locked, get, db, now, identity, isCache, canonicalUrl, retentionMs, protectedIds, updateRetention }) {
    async function reconcileMembership() {
        return locked(async () => {
            const prefs = await get('userPreferences', {});
            const board = new Set((await get('boardStates', [])).map(identity));
            const members = await get('cacheMembers', {});
            const sharedLedger = await db.get(
                'cacheIdentityLedger',
                { type: 'json', shared: true }
            ) || { initialized_at: now(), articles: {}, dismissals: {} };

            let ledger = sharedLedger;
            let ledgerChanged = false;

            const mutableLedger = () => {
                if (!ledgerChanged) {
                    ledger = structuredClone(sharedLedger);
                    ledgerChanged = true;
                }
                return ledger;
            };

            // A stale preference snapshot is not an explicit Cache dismissal.
            // Restore missing mappings for members that are still pinned; explicit
            // moves/removals update membership through setFolder.
            prefs.boardFolderMappings ||= {};
            const mapped = new Set(Object.keys(prefs.boardFolderMappings).map(identity));
            for (const [id, member] of Object.entries(members)) {
                if (member.in_cache && board.has(id) && !mapped.has(id)) {
                    prefs.boardFolderMappings[member.url] = 'cache';
                    prefs.boardFolders = [...new Set([...(prefs.boardFolders || []), 'cache'])];
                }
            }
            const present = new Set();
            // Existing members already own their metadata. Only load a corpus
            // when a newly pinned member actually needs hydration.
            let articlePool;
            const findArticle = async id => {
                articlePool ||= await Promise.all(['articles', 'smartRawArticles'].map(key =>
                    db.get(key, { type: 'json', shared: true })));
                for (const articles of articlePool) {
                    const match = (articles || []).find(article => identity(article) === id);
                    if (match) return structuredClone(match);
                }
            };
            for (const [link, folder] of Object.entries(prefs.boardFolderMappings || {})) {
                const id = identity(link);
                if (!id || !isCache(folder) || !board.has(id)) continue;
                present.add(id);
                members[id] ||= { thread_id: id, url: canonicalUrl(link), article: (await findArticle(id)) || { link, title: link }, active_caching: true, auto_added: false };
                if (members[id].in_cache === false) members[id].active_caching = true;
                if (members[id].in_cache === false) { members[id].left_cache_at = null; members[id].archive_expired_at = null; }
                members[id].in_cache = true;
            }
            for (const [id, member] of Object.entries(members)) {
                if (member.in_cache !== false && !present.has(id)) {
                    member.in_cache = false;
                    member.left_cache_at ||= new Date(now()).toISOString();
                    member.active_caching = false;
                    if (member.auto_added) {
                        mutableLedger().dismissals[id] = {
                            last_seen_at: now(),
                            expires_at: now() + retentionMs
                        };
                    }
                }
            }
            const protectedArchives = await protectedIds();
            for (const [id, member] of Object.entries(members)) updateRetention(member, protectedArchives.has(id));
            for (const [id, dismissal] of Object.entries(ledger.dismissals || {})) {
                if (dismissal.expires_at <= now()) {
                    delete mutableLedger().dismissals[id];
                }
            }

            const writes = {
                cacheMembers: JSON.stringify(members),
                userPreferences: JSON.stringify(prefs)
            };

            if (ledgerChanged) {
                writes.cacheIdentityLedger = JSON.stringify(ledger);
            }

            await db.putMany(writes);
            return members;
        });
    }
    return reconcileMembership;
}

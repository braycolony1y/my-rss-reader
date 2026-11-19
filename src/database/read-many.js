export async function readMany(db, keys, options = {}) {
    if (db.getMany) return db.getMany(keys, options);
    return Object.fromEntries(await Promise.all(keys.map(async key => [key, await db.get(key, {type:'json',...options})])));
}

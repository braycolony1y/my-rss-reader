import { hash, describe, tableFor, rowIdentity, CRITICAL_ARRAYS, CHILD_FIELDS } from './codec.js';
import { normalizeStateUrl } from '../../utils/state-url.js';

export function createRepository(db) {
    const prepared = new Map();
    const sql = text => { if (!prepared.has(text)) prepared.set(text, db.prepare(text)); return prepared.get(text); };
    let writes = 0, unchanged = 0;
    const info = key => sql('SELECT * FROM collections WHERE name=?').get(key);
    const source = url => {
        if (!url) return null;
        sql('INSERT INTO sources(url) VALUES(?) ON CONFLICT DO NOTHING').run(String(url));
        return sql('SELECT id FROM sources WHERE url=?').get(String(url)).id;
    };
    function record(key, id, position, value) {
        if(CHILD_FIELDS[key]?.has(id) && value && typeof value==='object') {
            const child=`$${key}.${id}`;
            write(child,value,{allowLargeReduction:true});
            value={$sqliteCollection:child};
        }
        const table = tableFor(key), serialized = JSON.stringify(value), digest = hash(serialized);
        const prior = sql(`SELECT digest,position FROM ${table} WHERE collection=? AND row_key=?`).get(key,id);
        if (prior?.digest === digest) {
            if (prior.position !== position) { sql(`UPDATE ${table} SET position=? WHERE collection=? AND row_key=?`).run(position,key,id); writes++; }
            else unchanged++;
            return digest;
        }
        const article = value && typeof value === 'object' ? value : {};
        if (table === 'articles') {
            const related = Array.isArray(article.relatedArticles), payload = related ? { ...article } : value;
            if (related) delete payload.relatedArticles;
            const date = Date.parse(article.pubDate || '');
            sql(`INSERT INTO articles(collection,row_key,position,source_id,link,normalized_link,article_id,cluster_id,title,category,region,published_at,hotness,payload,related,digest)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(collection,row_key) DO UPDATE SET
                position=excluded.position,source_id=excluded.source_id,link=excluded.link,normalized_link=excluded.normalized_link,article_id=excluded.article_id,
                cluster_id=excluded.cluster_id,title=excluded.title,category=excluded.category,region=excluded.region,
                published_at=excluded.published_at,hotness=excluded.hotness,payload=excluded.payload,related=excluded.related,digest=excluded.digest`)
                .run(key,id,position,source(article.feedUrl),article.link == null ? null : String(article.link),normalizeStateUrl(article.link),
                    article.articleKey == null ? null : String(article.articleKey),article.clusterId == null ? null : String(article.clusterId),
                    article.title == null ? null : String(article.title),article.smartCategory ?? article.feedCategory ?? null,
                    article.region ?? null,Number.isFinite(date) ? date : null,Number.isFinite(article.hotness) ? article.hotness : null,
                    JSON.stringify(payload),related ? Object.keys(article).indexOf('relatedArticles') + 1 : 0,digest);
            sql('DELETE FROM cluster_members WHERE collection=? AND cluster_key=?').run(key,id);
            if (related) for (const [i, member] of article.relatedArticles.entries())
                sql('INSERT INTO cluster_members VALUES(?,?,?,?,?)').run(key,id,i,member?.link ?? null,JSON.stringify(member));
            sql('DELETE FROM rankings WHERE collection=? AND article_key=?').run(key,id);
            if (article.topStory?.feed) sql('INSERT INTO rankings VALUES(?,?,?,?,?,?)').run(key,id,String(article.topStory.feed),
                Number.isInteger(article.topStory.rank) ? article.topStory.rank : null,
                Number.isFinite(article.ranking?.score) ? article.ranking.score : null,article.topStory.isTop ? 1 : 0);
        } else if (table === 'feeds') {
            sql(`INSERT INTO feeds VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(collection,row_key) DO UPDATE SET
                position=excluded.position,source_id=excluded.source_id,title=excluded.title,category=excluded.category,payload=excluded.payload,digest=excluded.digest`)
                .run(key,id,position,source(article.url),article.title ?? null,article.category ?? null,serialized,digest);
        } else {
            const link = typeof value === 'string' ? value : value?.url ?? value?.link ?? (key === 'recentReadAt' ? id : null);
            const withLink = table === 'boards' || table === 'reading_states';
            sql(`INSERT INTO ${table}(collection,row_key,position,${withLink ? 'link,' : ''}value,digest)
                VALUES(${withLink ? '?,?,?,?,?,?' : '?,?,?,?,?'}) ON CONFLICT(collection,row_key) DO UPDATE SET
                position=excluded.position,${withLink ? 'link=excluded.link,' : ''}value=excluded.value,digest=excluded.digest`)
                .run(...[key,id,position,...(withLink ? [link == null ? null : String(link)] : []),serialized,digest]);
        }
        writes++;
        return digest;
    }
    function materialize(row, key) {
        let value = JSON.parse(row.payload ?? row.value);
        if(CHILD_FIELDS[key]?.has(row.row_key) && value?.$sqliteCollection===`$${key}.${row.row_key}`)
            return read(value.$sqliteCollection);
        if (tableFor(key) === 'articles' && row.related) {
            const members = sql(
            'SELECT payload FROM cluster_members WHERE collection=? AND cluster_key=? ORDER BY position'
            ).all(key,row.row_key).map(member => JSON.parse(member.payload));
            const pairs=Object.entries(value);pairs.splice(row.related-1,0,['relatedArticles',members]);
            value=Object.fromEntries(pairs);
        }
        return value;
    }
    function* entries(key) {
        const table = tableFor(key);
        // A child collection can recursively open the same query shape. Its
        // iterator must have its own statement rather than reset a cached one.
        for (const row of db.prepare(`SELECT * FROM ${table} WHERE collection=? ORDER BY position`).iterate(key))
            yield { key:row.row_key, value:materialize(row,key), digest:row.digest };
    }
    function read(key) {
        const descriptor = info(key);
        if (!descriptor) return null;
        if (descriptor.shape === 'scalar') return JSON.parse(descriptor.scalar);
        const serialized=serializeCollection(key,descriptor);
        return descriptor.encoding==='json'?serialized:JSON.parse(serialized);
    }
    function serializeCollection(key,descriptor=info(key)){
        if(!descriptor)return 'null';
        if(descriptor.shape==='scalar')return descriptor.scalar;
        const array=descriptor.shape==='array',parts=[array?'[':'{'];let first=true;
        for(const row of db.prepare(`SELECT * FROM ${tableFor(key)} WHERE collection=? ORDER BY position`).iterate(key)){
            let json=row.payload??row.value;
            if(CHILD_FIELDS[key]?.has(row.row_key)){
                const marker=JSON.parse(json);
                if(marker?.$sqliteCollection===`$${key}.${row.row_key}`)json=serializeCollection(marker.$sqliteCollection);
            }else if(tableFor(key)==='articles'&&row.related)json=JSON.stringify(materialize(row,key));
            parts.push((first?'':',')+(array?'':JSON.stringify(row.row_key)+':')+json);first=false;
        }
        parts.push(array?']':'}');return parts.join('');
    }
    function beginCollection(key, encoding, shape) {
        const previous = info(key);
        sql(`INSERT INTO collections(name,encoding,shape) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET encoding=excluded.encoding,shape=excluded.shape`).run(key,encoding,shape);
        if (previous && previous.shape !== shape) sql(`DELETE FROM ${tableFor(key)} WHERE collection=?`).run(key);
        return previous;
    }
    function finishCollection(key, previous, encoding, shape, digest, count, scalar = null) {
        const changed = !previous || previous.digest !== digest || previous.encoding !== encoding || previous.shape !== shape;
        if (changed) sql('UPDATE collections SET encoding=?,shape=?,revision=revision+1,digest=?,item_count=?,scalar=? WHERE name=?')
            .run(encoding,shape,digest,count,scalar,key);
        return changed;
    }
    function write(key, value, options = {}) {
        if (value === undefined) throw Error(`Undefined database value: ${key}`);
        const {encoding,shape,decoded} = describe(key,value), prior = info(key);
        const count = shape === 'array' ? decoded.length : shape === 'object' ? Object.keys(decoded).length : 0;
        if (prior && CRITICAL_ARRAYS.has(key)) {
            if (prior.item_count > 0 && !count && !(key === 'blockedArticleKeywords' && options.allowLargeReduction)) throw Error(`[DB SAFETY] Refusing to wipe ${prior.item_count} ${key}`);
            const minimum = key === 'feeds' && prior.item_count >= 3 ? .5 : prior.item_count >= 20 ? .1 : 0;
            if (minimum && count < Math.ceil(prior.item_count * minimum) && !options.allowLargeReduction) throw Error(`[DB SAFETY] Refusing unexpected ${key} reduction`);
        }
        const previous = beginCollection(key,encoding,shape);
        if (shape === 'scalar') return finishCollection(key,previous,encoding,shape,hash(JSON.stringify(value)),0,JSON.stringify(value));
        const seen = new Map(), keep = new Set(), digest = [];
        const iterable = shape === 'array' ? decoded.entries() : Object.entries(decoded);
        let position = 0;
        for (const [index,item] of iterable) {
            const id = shape === 'array' ? rowIdentity(item,index,seen) : index;
            keep.add(id); const rowDigest=record(key,id,position++,item);
            digest.push([id,CHILD_FIELDS[key]?.has(id) && item && typeof item==='object' ? info(`$${key}.${id}`).digest : rowDigest]);
        }
        for (const row of sql(`SELECT row_key FROM ${tableFor(key)} WHERE collection=?`).all(key)) {
            if (!keep.has(row.row_key)) { sql(`DELETE FROM ${tableFor(key)} WHERE collection=? AND row_key=?`).run(key,row.row_key); writes++; }
        }
        return finishCollection(key,previous,encoding,shape,hash(JSON.stringify(digest)),count);
    }
    function findArticles(key, { links, normalizedLinks, category, limit, offset = 0 } = {}) {
        if (tableFor(key) !== 'articles') throw Error('Not an article collection');
        if (links && !links.length) return [];
        if (normalizedLinks && !normalizedLinks.length) return [];
        // JSON_each binds a single parameter, avoiding SQLite's variable limit.
        const clauses = ['collection=?'], params = [key];
        if (links) { clauses.push('link IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(links)); }
        if (normalizedLinks) { clauses.push('normalized_link IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(normalizedLinks.map(normalizeStateUrl))); }
        if (category) { clauses.push('category=?'); params.push(category); }
        let query = 'SELECT * FROM articles WHERE ' + clauses.join(' AND ') + ' ORDER BY position';
        if (limit != null) { query += ' LIMIT ? OFFSET ?'; params.push(Math.max(0,limit),Math.max(0,offset)); }
        return sql(query).all(...params).map(row => materialize(row,key));
    }
    function linkProjection(key) {
        if(tableFor(key)!=='articles')throw Error('Link projection requires article collection');
        if(!info(key))return null;
        return sql('SELECT row_key,link,related FROM articles WHERE collection=? ORDER BY position').all(key).map(row=>({link:row.link,
            ...(row.related?{relatedArticles:sql('SELECT link FROM cluster_members WHERE collection=? AND cluster_key=? ORDER BY position').all(key,row.row_key)}:{})}));
    }
    function mapEntries(key,ids){
        if(!info(key))return {};
        if(info(key).shape!=='object')throw Error('Entry lookup requires an object collection');
        const rows=sql(`SELECT * FROM ${tableFor(key)} WHERE collection=? AND row_key IN (SELECT value FROM json_each(?))`).all(key,JSON.stringify(ids));
        return Object.fromEntries(rows.map(row=>[row.row_key,materialize(row,key)]));
    }
    function patchMap(key,values,remove=[]){
        const prior=info(key);
        if(prior&&prior.shape!=='object')throw Error('Entry update requires an object collection');
        const encoding=prior?.encoding||'json';beginCollection(key,encoding,'object');
        const table=tableFor(key);
        let nextPosition=sql(`SELECT coalesce(max(position),-1)+1 position FROM ${table} WHERE collection=?`).get(key).position;
        for(const [id,value]of Object.entries(values)){
            const position=sql(`SELECT position FROM ${table} WHERE collection=? AND row_key=?`).get(key,id)?.position??nextPosition++;
            record(key,id,position,value);
        }
        for(const id of remove)sql(`DELETE FROM ${table} WHERE collection=? AND row_key=?`).run(key,id);
        const digests=sql(`SELECT row_key,digest FROM ${table} WHERE collection=? ORDER BY position`).all(key).map(row=>[row.row_key,row.digest]);
        return finishCollection(key,prior,encoding,'object',hash(JSON.stringify(digests)),digests.length);
    }
    return { info, read, write, record, entries, beginCollection, finishCollection, findArticles,linkProjection,mapEntries,patchMap,
        keys: ({internal=false}={}) => sql(internal?'SELECT name FROM collections ORDER BY name':"SELECT name FROM collections WHERE name NOT LIKE '$%' ORDER BY name").all().map(row=>row.name),
        stats: () => ({writes,unchanged,statements:prepared.size}),
    };
}

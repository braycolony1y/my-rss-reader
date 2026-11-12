// A global refresh replaces the prior raw snapshot. Only targeted refreshes
// need that snapshot to preserve the other categories.
export async function previousSmartArticles(db,isTargeted) {
    return isTargeted ? (await db.get('smartRawArticles',{type:'json',shared:true}))||[] : [];
}

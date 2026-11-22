// Old Smart links keep working. Top stories and the Top/Classic toggle are gone, so any hash that
// names the smart, top, classic or stories view (optionally carrying a mode word or a smartMode=
// query) opens Stories on the same section. Nothing here ever fails: unknown input is passed through.
const ReaderSmartLegacyRoutes = {
    viewTypes: ['smart', 'top', 'classic', 'stories'],
    modeWords: ['top', 'classic'],
    section: /^(?:news|finance|tech)(?:_(?:vietnam|global|world|foreign))?$/i,
    // The hash type: smart/top/classic/stories all mean Stories (internal id 'smart').
    type(value) {
        return this.viewTypes.includes(String(value || '').toLowerCase()) ? 'smart' : value;
    },
    // Remove "?smartMode=top", "&mode=classic" and similar from a hash before it is parsed.
    stripModeQuery(hash) {
        return String(hash || '').replace(/[?&](?:smartMode|smart_mode|mode)=(?:top|classic)(?=$|[?&#])/gi, '');
    },
    // '#smart/news_vietnam', '#top/news_vietnam', '#smart/top/news_vietnam', '#smart/news_vietnam/classic'
    destination(segments) {
        const decoded = (segments || []).map(segment => { try { return decodeURIComponent(segment); } catch { return String(segment); } })
            .filter(segment => segment && !this.modeWords.includes(segment.toLowerCase()));
        return decoded.find(segment => this.section.test(segment)) || decoded[0] || null;
    }
};

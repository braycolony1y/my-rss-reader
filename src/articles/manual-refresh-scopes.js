export function manualRefreshOptions(feedUrl = null, category = null) {
    return {manualRefreshScopes: [{feedUrl: feedUrl || null, category: category || null}]};
}

export function mergeManualRefreshScopes(...groups) {
    return [...new Map(groups.flatMap(group => group || []).map(scope => [
        JSON.stringify([scope.feedUrl || null, scope.category || null]), scope
    ])).values()];
}

export function matchesManualRefresh(item, scopes = []) {
    return scopes.some(scope => scope.feedUrl ? scope.feedUrl === item.url
        : scope.category ? scope.category === item.category : true);
}

export function mergeManualRefreshOptions(...options) {
    const scopes = mergeManualRefreshScopes(...options.map(option => option?.manualRefreshScopes));
    return scopes.length ? {manualRefreshScopes: scopes} : {};
}

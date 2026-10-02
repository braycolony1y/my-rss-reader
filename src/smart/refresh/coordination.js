let activeSmartEngineRefreshes = 0;

function beginSmartRefresh() { activeSmartEngineRefreshes++; }
function endSmartRefresh() { activeSmartEngineRefreshes = Math.max(0, activeSmartEngineRefreshes - 1); }
function isSmartRefreshActive() { return activeSmartEngineRefreshes > 0; }

export { beginSmartRefresh, endSmartRefresh, isSmartRefreshActive };

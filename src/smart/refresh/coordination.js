let activeSmartEngineRefreshes = 0;
let smartRefreshGeneration = 0;

function beginSmartRefresh() { activeSmartEngineRefreshes++; smartRefreshGeneration++; }
function endSmartRefresh() { activeSmartEngineRefreshes = Math.max(0, activeSmartEngineRefreshes - 1); }
function isSmartRefreshActive() { return activeSmartEngineRefreshes > 0; }

function getSmartRefreshGeneration() { return smartRefreshGeneration; }

export { beginSmartRefresh, endSmartRefresh, isSmartRefreshActive, getSmartRefreshGeneration };

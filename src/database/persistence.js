// Durable overlay commits and complete corpus snapshots share the existing DB lock.
export function createDatabasePersistence({SMART_STATE_KEYS,STATE_KEYS,SMART_KEYS,NON_PERSISTED_DB_KEYS,SMART_DB_FILE,DB_FILE,stateFiles,smartStateFiles,getOverlayState,commitOverlayState,_writeJsonAtomic,_validateDatabaseSnapshot,_createRecoverySnapshot}) {
    return async function persist(data, previousData, updatedKeys = null, options = {}) {
        let {stateRevision,stateOverlay,smartStateRevision,smartStateOverlay} = getOverlayState();
        const changedKeys = Array.isArray(updatedKeys)
            ? updatedKeys
            : (updatedKeys ? [updatedKeys] : []);
        if (changedKeys.length && changedKeys.every(key => SMART_STATE_KEYS.has(key))) {
            const values = { ...smartStateOverlay };
            for (const key of changedKeys) values[key] = data[key];
            const revision = smartStateRevision + 1;
            await smartStateFiles.write({revision,values,changedKeys});
            smartStateOverlay = values;
            smartStateRevision = revision;
            commitOverlayState({smartStateRevision,smartStateOverlay});
            return;
        }
        // Both single and batch state updates use the durable overlay. A caller
        // should not have to opt in to avoid rewriting the article corpus.
        if (changedKeys.length && changedKeys.every(key => STATE_KEYS.has(key))) {
            const values = { ...stateOverlay };
            for (const key of changedKeys) values[key] = data[key];
            const revision = stateRevision + 1;
            await stateFiles.write({revision,values,changedKeys});
            stateOverlay = values;
            stateRevision = revision;
            commitOverlayState({stateRevision,stateOverlay});
            return;
        }
        const smartChanged = changedKeys.some(key => SMART_KEYS.has(key));
        const mainChanged = changedKeys.length === 0 || changedKeys.some(key => !SMART_KEYS.has(key));

        if (smartChanged) {
            const smartData = {};
            for (const k of SMART_KEYS) if (k in data && data[k] !== undefined) smartData[k] = data[k];
            smartData.__smartStateRevision = smartStateRevision;
            if (previousData) {
                const prevSmartData = {};
                for (const k of SMART_KEYS) if (k in previousData && previousData[k] !== undefined) prevSmartData[k] = previousData[k];
                prevSmartData.__smartStateRevision = smartStateRevision;
                if (Object.keys(prevSmartData).length > 0) {
                    await _writeJsonAtomic(SMART_DB_FILE + '.backup', prevSmartData).catch(() => {});
                }
            }
            await _writeJsonAtomic(SMART_DB_FILE, smartData);
            smartStateOverlay = {};
            commitOverlayState({smartStateOverlay});
            await smartStateFiles.clear().catch(error => console.warn('[DB SMART STATE]',error.message));
            if (!mainChanged) return;
        }

        const mainData = {};
        for (const k in data) if (!SMART_KEYS.has(k) && !NON_PERSISTED_DB_KEYS.has(k) && data[k] !== undefined) mainData[k] = data[k];

        mainData.__stateRevision = stateRevision;
        const validation = _validateDatabaseSnapshot(mainData, true);
        if (!validation.ok) throw new Error(`Refusing unsafe database write: ${validation.reason}`);

        if (previousData) {
            const prevMainData = {};
            for (const k in previousData) if (!SMART_KEYS.has(k) && !NON_PERSISTED_DB_KEYS.has(k) && previousData[k] !== undefined) prevMainData[k] = previousData[k];
            prevMainData.__stateRevision = stateRevision;
            if (_validateDatabaseSnapshot(prevMainData, true).ok) {
                await _writeJsonAtomic(DB_FILE + '.backup', prevMainData);
                await _createRecoverySnapshot(prevMainData).catch(error => {
                    console.error('[DB WARNING] Could not create rotating recovery snapshot:', error.message);
                });
            }
        }
        await _writeJsonAtomic(DB_FILE, mainData);
        // The full snapshot now contains all overlay values. A crash before
        // unlink is safe because readers compare revisions before replaying.
        stateOverlay = {};
        commitOverlayState({stateOverlay});
        await stateFiles.clear().catch(error => console.warn('[DB STATE]',error.message));
    };
}

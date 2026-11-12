export function manualSyncOutcome(result = {}) {
    const failed = result.success === false || result.smart?.ok === false || result.logs?.length > 0;
    return {failed, message: failed
        ? 'Some sources could not refresh. Existing articles were kept.'
        : 'Refresh complete.'};
}

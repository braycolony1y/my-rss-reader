// One RSS cycle is the persistence boundary for newly observed identities.
// Keep source order and object identity (including later image resolution),
// and use the existing Board transaction for dismissal/auto-add decisions.
export function createCacheObservationBatch(observe) {
    let batches = [];
    return {
        add(articles) { batches.push(articles); },
        async flush() {
            if (!batches.length) return;
            const completed = batches;
            batches = [];
            await observe(completed.flat());
        }
    };
}

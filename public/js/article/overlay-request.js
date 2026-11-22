// Abort the old reader transport when its owner closes or switches articles.
// Request IDs still guard every response, including transports without abort.
const ReaderOverlayRequest = {
    owners: new WeakMap(),
    cancel(app) {
        this.owners.get(app.__readerOwner || app)?.controller?.abort();
        this.owners.delete(app.__readerOwner || app);
    },
    fetch(app, requestId, url) {
        let owner = this.owners.get(app.__readerOwner || app);
        if (owner?.requestId !== requestId) {
            this.cancel(app);
            owner = {requestId, controller: typeof AbortController === 'function' ? new AbortController() : null};
            this.owners.set(app.__readerOwner || app, owner);
        }
        return fetch(url, {signal: owner.controller?.signal});
    }
};

import {AsyncLocalStorage} from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function publisherFetchContext(captured) {
    return captured === undefined ? storage.getStore() || null : captured;
}

export function withPublisherFetchContext(context, task) {
    return storage.run(context || null, task);
}

export function withPublisherFetchKind(kind, task) {
    const current = publisherFetchContext();
    return withPublisherFetchContext(current?.kind === kind ? current : {kind}, task);
}

export function capturePublisherFetchContext(context) {
    const current = storage.getStore();
    context.publisherFetchContext = current || null;
    return context;
}

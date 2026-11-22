// A server-side sanitizer returns strings, not its temporary DOM documents.
// Detach those trees after serialization so jsdom's long-lived Window named
// property tracker releases their id/name-bearing elements and descendants.
// This scope is synchronous and string-output only: do not use it with
// DOMPurify's RETURN_DOM, RETURN_DOM_FRAGMENT, or IN_PLACE options.
export function createSanitizerDocumentScope(window, purifier) {
    const primaryDocument = window.document;
    const ownerDocument = Object.getOwnPropertyDescriptor(window.Node.prototype, 'ownerDocument').get;
    const firstChild = Object.getOwnPropertyDescriptor(window.Node.prototype, 'firstChild').get;
    const removeChild = window.Node.prototype.removeChild;
    let activeDocuments = null;

    purifier.addHook('beforeSanitizeElements', node => {
        const document = ownerDocument.call(node);
        if (document && document !== primaryDocument) activeDocuments?.add(document);
    });

    return operation => {
        const previous = activeDocuments;
        const documents = new Set();
        activeDocuments = documents;
        try {
            return operation();
        } finally {
            activeDocuments = previous;
            for (const document of documents) {
                let child;
                while ((child = firstChild.call(document))) removeChild.call(document, child);
            }
        }
    };
}

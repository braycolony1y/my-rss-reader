// Descriptor composition keeps computed Alpine getters lazy and methods
// unbound. Object spread/assign would eagerly evaluate getters on an incomplete
// feature object instead of evaluating them later on the Alpine proxy.
const ReaderComponent = {
    compose(factories) {
        const component = {};
        for (const create of factories) {
            Object.defineProperties(component, Object.getOwnPropertyDescriptors(create()));
        }
        // Alpine creates different evaluation proxies for separate DOM events.
        // Frozen ownership stays identical through each reactive proxy.
        Object.defineProperty(component, '__readerOwner', {value: Object.freeze({})});
        return component;
    }
};

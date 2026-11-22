const ReaderTinhte = {
    installComparison() {
        document.addEventListener('input', e => {
            if (e.target.matches('.compare-slider')) {
                const container = e.target.closest('.tinhte-photo-compare');
                if (container) {
                    const overlay = container.querySelector('.compare-overlay');
                    const handle = container.querySelector('.compare-handle');
                    if (overlay) overlay.style.clipPath = `inset(0 ${100 - e.target.value}% 0 0)`;
                    if (handle) handle.style.left = `${e.target.value}%`;
                }
            }
        });


    },
    installNavigation() {
// Keep publisher section links inside the reader without changing the feed route.
document.addEventListener('click', event => {
    const link = event.target.closest?.('.tinhte-quick-view a[href^="#"]');
    if (!link) return;
    const article = link.closest('.tinhte-article');
    const target = article?.querySelector('[id="' + CSS.escape(link.getAttribute('href').slice(1)) + '"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}, true);



    }
};

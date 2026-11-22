const ReaderGroundNews = {
    install() {
// Capture runs before the reader overlay's Alpine @click.stop boundary.
// Keep summary selection and publisher filtering independent of one another.
document.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-ground-filter], button[data-ground-summary]');
    const story = button?.closest('.ground-story');
    if (!story) return;
    if (button.hasAttribute('data-ground-summary')) {
        const selected = button.dataset.groundSummary;
        story.querySelectorAll('[data-ground-summary]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
        story.querySelectorAll('[data-ground-summary-panel]').forEach(panel => { panel.hidden = panel.dataset.groundSummaryPanel !== selected; });
        return;
    }
    const selected = button.dataset.groundFilter;
    story.querySelectorAll('[data-ground-filter]').forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
    let visible = 0;
    story.querySelectorAll('[data-ground-bias]').forEach(publisher => {
        publisher.hidden = selected !== 'all' && publisher.dataset.groundBias !== selected;
        if (!publisher.hidden) visible++;
    });
    const empty = story.querySelector('.ground-empty');
    if (empty) empty.hidden = visible > 0;
}, true);
document.addEventListener('error', event => {
    if (event.target.matches?.('img.ground-publisher-logo')) event.target.hidden = true;
}, true);


    }
};

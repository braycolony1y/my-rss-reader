const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function groundBiasGroup(bias) {
    if (['left', 'leanLeft', 'farLeft'].includes(bias)) return 'left';
    if (['right', 'leanRight', 'farRight'].includes(bias)) return 'right';
    return bias === 'center' ? 'center' : 'unrated';
}
function safeLogo(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function summaryMarkup(value) {
    if (typeof value !== 'string' || !value.trim()) return '<p class="ground-coverage-note">This summary is not available from Ground News.</p>';
    const lines = value.split(/\n+/).map(line => line.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
    return `<ul class="ground-summary-points">${lines.map(line => `<li>${escape(line).replace(/\*([^*]+)\*/g, '<em>$1</em>')}</li>`).join('')}</ul>`;
}
export function renderGroundNewsStory(item) {
    const metadata = item.groundNews || {};
    const bias = metadata.blindspotData || {};
    const groups = [
        { key: 'left', label: 'Left', percent: number(bias.leftPercent), count: number(bias.leftSrcCount) },
        { key: 'center', label: 'Center', percent: number(bias.centerPercent), count: number(bias.cntrSrcCount) },
        { key: 'right', label: 'Right', percent: number(bias.rightPercent), count: number(bias.rightSrcCount) }
    ];
    const summaryChoices = [...groups, { key: 'analysis', label: 'Bias Comparison' }];
    const summaries = metadata.summaries || {};
    const selectedSummary = summaryChoices.find(g => typeof summaries[g.key] === 'string' && summaries[g.key].trim())?.key || 'left';
    const summaryTabs = summaryChoices.map(g => `<button type="button" class="ground-filter" data-ground-summary="${g.key}" aria-pressed="${g.key === selectedSummary}">${g.label}</button>`).join('');
    const summaryPanels = summaryChoices.map(g => `<div class="ground-summary-panel" data-ground-summary-panel="${g.key}" aria-label="${g.label} summary"${g.key === selectedSummary ? '' : ' hidden'}>${summaryMarkup(summaries[g.key])}</div>`).join('');
    const perspectives = `<section class="ground-perspectives" aria-label="Ground News perspectives"><div class="ground-filters ground-summary-filters" role="group" aria-label="Choose a coverage summary">${summaryTabs}</div>${summaryPanels}<p class="ground-coverage-note">Summaries and bias comparison by Ground News.</p></section>`;
    const total = number(metadata.sourceCount);
    const sources = (metadata.sources || []).filter(s => /^https?:\/\//.test(s.url || ''));
    const coverage = groups.map(g => `<div class="ground-coverage-stat ground-bias-${g.key}"><span>${g.label}</span><strong>${g.percent === null ? '—' : `${g.percent}%`}</strong></div>`).join('');
    const tabs = [{ key: 'all', label: 'All', count: null }, ...groups].map(g => `<button type="button" class="ground-filter" data-ground-filter="${g.key}" aria-pressed="${g.key === 'all'}">${g.label}${g.count === null ? '' : `<span>${g.count}</span>`}</button>`).join('');
    const cards = sources.map(s => {
        const group = groundBiasGroup(s.bias);
        const label = group === 'unrated' ? 'Unrated' : group[0].toUpperCase() + group.slice(1);
        const published = s.date && Number.isFinite(Date.parse(s.date)) ? new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
        const logo = safeLogo(s.sourceInfo?.icon || s.icon);
        const identity = `<span class="ground-publisher-identity">${logo ? `<img class="ground-publisher-logo" src="${escape(logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}<span class="ground-publisher-name">${escape(s.name || new URL(s.url).hostname)}</span></span>`;
        return `<a class="ground-publisher" data-ground-bias="${group}" href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${identity}<span class="ground-publisher-meta"><span class="ground-bias-label ground-bias-${group}">${label}</span>${published ? `<time datetime="${escape(s.date)}">${escape(published)}</time>` : ''}<span aria-hidden="true">↗</span></span></a>`;
    }).join('');
    return `<section class="ground-story" data-ground-reader="2">
        <div class="ground-summary">${String(item.description || '').split(/\n+/).filter(Boolean).map(p => `<p>${escape(p)}</p>`).join('')}</div>
        ${perspectives}
        <section class="ground-coverage" aria-label="Political bias coverage"><div class="ground-section-heading">Coverage</div><div class="ground-coverage-stats">${coverage}</div></section>
        <section class="ground-articles" aria-label="Publisher articles"><div class="ground-section-heading">${total === null ? 'Articles' : `${total} Articles`}</div><div class="ground-filters" role="group" aria-label="Filter publishers by political bias">${tabs}</div>
        <div class="ground-publishers">${cards}</div><p class="ground-empty" hidden>No publisher links available for this filter.</p>
        ${sources.length < (total || 0) ? '<p class="ground-coverage-note">Publisher links available from Ground News. Coverage totals may include additional articles.</p>' : ''}
        <a class="ground-original" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">View full coverage on Ground News ↗</a></section></section>`;
}

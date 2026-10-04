import { applyTopStoryImage, storyBlendState } from '../blend/runtime.js?v=20261004_fill_1';
import { showBlendDebug } from './debug.js';
const manifest = await (await fetch('./manifest.json')).json();
const container = document.querySelector('#scroll-container');
const width = document.querySelector('#width'), theme = document.querySelector('#theme'), debug = document.querySelector('#debug');
const entries = [];
for (const sample of manifest.samples) {
    const section = document.createElement('section'); section.className = 'review-sample';
    section.innerHTML = manifest.capturedCard;
    const card = section.querySelector('.article-card');
    card.dataset.fixture = sample.id;
    if (sample.id !== 'S1') { card.querySelector('h2').textContent = sample.title; card.querySelector('.article-card-heading p').textContent = sample.excerpt; }
    const img = card.querySelector('.thumbnail-img'); img.src = sample.analysis.assets.heroImage; img.dataset.focusState = 'ready';
    const label = document.createElement('p'); label.className = 'review-caption'; label.textContent = sample.id + ' · ' + sample.label;
    section.append(label); container.append(section);
    const state = { focus: { x: sample.analysis.focal.x, y: sample.analysis.focal.y }, blend: { story: sample.analysis }, source: sample.imageUrl, settled: true, near: true };
    entries.push({ card, img, state });
    card.querySelector('.thumbnail-soft')?.addEventListener('load', update);
}
function update() {
    document.body.dataset.reviewTheme = theme.value;
    for (const { card, img, state } of entries) {
        card.style.width = width.value + 'px'; card.style.maxWidth = 'none';
        applyTopStoryImage(img, state, { ready: true, forceLight: theme.value === 'light' });
        showBlendDebug(card, storyBlendState(card), debug.checked);
    }
    document.documentElement.dataset.reviewReady = 'true';
}
for (const control of [width, theme, debug]) control.addEventListener('change', update);
window.addEventListener('resize', update);
await document.fonts.ready;
update();
window.topStoryReview = { entries, update, storyBlendState };

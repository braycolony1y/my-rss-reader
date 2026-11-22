export function showBlendDebug(card, state, enabled) {
    card.querySelector('.blend-debug-layer')?.remove();
    if (!enabled || !state) return;
    const { p, width, height, panelTop, avatar } = state.geometry;
    const layer = document.createElement('div'); layer.className = 'blend-debug-layer'; layer.setAttribute('aria-hidden', 'true');
    const add = (className, style, text = '') => { const el = document.createElement('div'); el.className = className; Object.assign(el.style, style); el.textContent = text; layer.append(el); return el; };
    const rectangle = (name, r) => add('blend-debug-rect ' + name, { left: r.left * 100 + '%', top: r.top * 100 + '%', width: (r.right - r.left) * 100 + '%', height: (r.bottom - r.top) * 100 + '%' });
    rectangle('blend-debug-focal', p.subject); rectangle('blend-debug-avatar', avatar);
    add('blend-debug-target', { left: p.target.x * 100 + '%', top: p.target.y * 100 + '%' }, 'T');
    add('blend-debug-guide', { top: panelTop * 100 + '%' });
    add('blend-debug-guide', { top: p.meltStart * 100 + '%', borderColor: '#28a36a' });
    add('blend-debug-label', { right: '8px', bottom: '8px' }, `Mode ${p.mode} · ${p.placement} · zoom ${p.scale.toFixed(2)} · avatar ${state.avatarZoneLum.toFixed(2)}`);
    add('blend-debug-heat', { width: p.heroW + 'px', height: p.heroH + 'px', maskImage: p.maskH + ', ' + p.maskV, maskComposite: 'intersect' });
    for (const c of state.analysis.clusters) add('blend-debug-centroid', { left: (width - p.heroW + p.offsetX + c.x * p.imageW) / width * 100 + '%', top: (p.offsetY + c.y * p.imageH) / height * 100 + '%', background: `oklch(${c.L} ${c.C} ${c.H})` });
    card.append(layer);
}

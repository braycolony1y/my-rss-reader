import {applyCardBlend,updateBlendGeometry} from './runtime.js';
const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19V11M10 19V5M16 19V8M22 19H2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export function createDemoCard(fixture,metadata,expanded) {
    const section=document.createElement('section');
    section.innerHTML=`<article class="liquid-card article-card has-story-briefing" data-image-layout="top"><div class="card-ambient" aria-hidden="true"></div><div class="article-card-header"><div class="article-card-image"><img class="thumbnail-soft" loading="lazy" alt="" aria-hidden="true"><div class="thumbnail-plate"><img class="thumbnail-img" loading="lazy" alt=""></div></div><div class="article-card-heading"><div class="article-metadata"><span>Design journal</span><span title="Published today">Today</span></div><h2></h2><p></p></div><div class="article-entity-row"><span class="article-entity-chip"></span></div></div><div class="article-card-panel"><div class="article-panel-content"><div class="article-briefing"><div class="story-key-facts">${[1,2,3].map(i=>`<div class="story-key-fact"><span class="story-key-fact-icon" aria-hidden="true">${icon}</span><span class="story-key-fact-copy"><strong>${i*12}%</strong><span>Illustrative metric</span></span></div>`).join('')}</div><div class="story-analysis-shell"><div class="story-analysis-tabs"><button class="is-active">Why it matters</button><button>What changed</button></div><div class="story-analysis-body"><div class="story-analysis-copy"><div class="story-analysis-text"><p>The image continues beside the entity row. This full-width panel sits below it, on the ambient color field.</p></div><button class="story-analysis-next" aria-label="Next section">›</button></div></div></div></div></div></div></article><p class="case"></p><button class="fixture-toggle" type="button">Toggle demo panel</button>`;
    const card=section.querySelector('article'),image=card.querySelector('.thumbnail-img'),panel=card.querySelector('.article-card-panel');
    card.dataset.fixture=fixture.id;card.dataset.blend=JSON.stringify(metadata);
    card.querySelector('h2').textContent=fixture.title;
    card.querySelector('.article-card-heading p').textContent=fixture.description;
    card.querySelector('.article-entity-chip').textContent=fixture.entity;
    section.querySelector('.case').textContent=fixture.label+' · '+(expanded?'Expanded':'Collapsed');
    const setExpanded=value=>{panel.dataset.expanded=String(value);panel.querySelector('.article-panel-content').inert=!value;section.querySelector('.fixture-toggle').setAttribute('aria-expanded',String(value));requestAnimationFrame(()=>updateBlendGeometry(card));};
    setExpanded(expanded);
    applyCardBlend(card,metadata);
    image.src=fixture.src;image.alt=fixture.label;
    section.querySelector('.fixture-toggle').addEventListener('click',()=>setExpanded(panel.dataset.expanded!=='true'));
    const observer=new ResizeObserver(()=>updateBlendGeometry(card));
    observer.observe(card);observer.observe(card.querySelector('.article-card-header'));
    image.addEventListener('load',()=>updateBlendGeometry(card));
    card.dataset.ready='true';
    return section;
}

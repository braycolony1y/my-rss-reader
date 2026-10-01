import {createDemoCard} from './demo-card.js';
import {updateBlendGeometry} from './runtime.js';
const fixtures=await(await fetch('./fixtures/manifest.json')).json();
for(const fixture of fixtures) {
    const metadata=await(await fetch(`./fixtures/${fixture.id}.json`)).json();
    for(const key of ['ambientImage','meltImage']) {
        const blob=await(await fetch(`./fixtures/${metadata[key]}`)).blob();
        metadata[key]=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});
    }
    fixture.src=`./fixtures/${fixture.id}.svg`;
    for(const expanded of [true,false])document.querySelector('#scroll-container').append(createDemoCard(fixture,metadata,expanded));
}
const width=document.querySelector('#width');
width.addEventListener('change',()=>document.documentElement.style.setProperty('--demo-width',`${width.value}px`));
document.querySelector('#read-toggle').addEventListener('change',e=>document.querySelectorAll('article').forEach(card=>card.classList.toggle('is-read',e.target.checked)));
document.querySelector('#mode').addEventListener('change',e=>document.querySelectorAll('article').forEach(card=>{
    card.classList.toggle('is-smart-classic-card',e.target.value==='classic');card.classList.toggle('is-standard-card',e.target.value==='standard');
    card.dataset.imageLayout=e.target.value==='top'?'top':'standard';
    if(e.target.value==='standard')card.querySelector('.article-card-panel').dataset.expanded='false';
    updateBlendGeometry(card);
}));
if(new URLSearchParams(location.search).has('debug'))await import('./debug.js');
fetch('./measurements.json').then(r=>r.json()).then(report=>document.querySelector('#report').textContent=JSON.stringify(report,null,2));

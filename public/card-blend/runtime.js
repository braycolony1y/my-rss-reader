import {blendTokens} from './color.js';
import {maskProperties} from './masks.js';
const asset=value=>typeof value==='string'&&value.length<150000&&/^data:image\/webp;base64,[a-zA-Z0-9+/=]+$/.test(value)?value:'';
const set=(el,key,value)=>{if(el&&el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value)};
export function updateBlendGeometry(card) {
    if(!card?.closest('.theme-glass-light'))return;
    const viewport=card.querySelector('.article-card-image');
    if(!viewport)return;
    const height=viewport.getBoundingClientRect().height;
    const header=card.querySelector('.article-card-header');
    const mobile=card.getBoundingClientRect().width<640;
    const full=[...card.querySelectorAll('.article-card-panel,.story-key-facts')].some(el=>el.getBoundingClientRect().height>1 && el.getBoundingClientRect().top>=header.getBoundingClientRect().bottom-1);
    const k=Number(card.style.getPropertyValue('--blend-k'))||0;
    set(card,'--plate-height',`${height.toFixed(2)}px`);
    set(card,'--fy',`${full||mobile?(mobile?Math.min(80,height*.4):Math.max(140,(.30+.10*k)*height)):0}px`);
    const next=String(full||mobile); if(card.dataset.blendBottom!==next)card.dataset.blendBottom=next;
}
export function applyCardBlend(card, metadata, {near=true}={}) {
    if(!card || (!card.closest('.theme-glass-light') && !card.classList.contains('liquid-card')))return;
    const blend=metadata || null;
    for(const [key,value] of Object.entries({...blendTokens(blend),...maskProperties(blend?.k)}))set(card,key,value);
    const ambient=asset(blend?.ambientImage),melt=asset(blend?.meltImage);
    set(card,'--ambient-image',ambient?`url("${ambient}")`:'none');
    const image=card.querySelector('.thumbnail-soft');
    if(image) {
        const src=near?melt:'';
        if(src&&image.getAttribute('src')!==src)image.src=src;
        else if(!src&&image.hasAttribute('src'))image.removeAttribute('src');
    }
    updateBlendGeometry(card);
}

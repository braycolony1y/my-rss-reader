const report=await(await fetch('/public/tint-demo/measurements.json')).json();
function render() {
 for(const card of document.querySelectorAll('article[data-fixture]')) {
  card.querySelector('.debug-points')?.remove();card.parentElement.querySelector('.debug-panel')?.remove();
  const width=card.getBoundingClientRect().width,expanded=card.querySelector('.article-card-panel').dataset.expanded==='true';
  const measurement=report.cards?.filter(row=>row.fixture===card.dataset.fixture&&row.expanded===expanded).sort((a,b)=>Math.abs(a.width-width)-Math.abs(b.width-width))[0];
  if(!measurement?.samples)continue;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('debug-points');
  svg.setAttribute('viewBox',`0 0 ${width} ${card.getBoundingClientRect().height}`);
  const rows=[];
  for(const [line,points] of measurement.samples.entries())for(const point of points) {
   const circle=document.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx',point.x);circle.setAttribute('cy',point.y);circle.setAttribute('r',1.5);svg.append(circle);
   rows.push(`${line}: (${point.x.toFixed(1)},${point.y.toFixed(1)}) L=${point.L.toFixed(4)} C=${point.C.toFixed(4)} H=${point.H.toFixed(1)} ΔL/4px=${point.deltaL.toFixed(4)}`);
  }
  card.append(svg);const text=document.createElement('pre');text.className='debug-panel';text.textContent=`Saved 2x browser samples · ${measurement.width}px · ${expanded?'expanded':'collapsed'}\n${rows.join('\n')}`;card.parentElement.append(text);
 }
}
render();document.querySelector('#width').addEventListener('change',()=>requestAnimationFrame(render));
document.querySelectorAll('.fixture-toggle').forEach(button=>button.addEventListener('click',()=>setTimeout(render,420)));

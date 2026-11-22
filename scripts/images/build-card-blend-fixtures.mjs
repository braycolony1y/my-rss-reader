import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildCardBlendAssets} from '../../src/images/card-blend/assets.js';
const output=new URL('../../public/tint-demo/fixtures/',import.meta.url);await mkdir(output,{recursive:true});
const scenes={
 officer:'<rect width="1200" height="800" fill="#c9bd9b"/><path d="M580 800V420Q600 320 820 340Q1050 380 1060 800" fill="#21372f"/><ellipse cx="805" cy="260" rx="110" ry="140" fill="#b6a289"/><path d="M680 205Q740 70 900 155L945 220Z" fill="#263d30"/>',
 aerial:'<rect width="1200" height="800" fill="#afb9be"/><path d="M0 450Q200 330 440 390T1200 330V800H0" fill="#8f9d79"/><path d="M0 680L1200 430" stroke="#d5d8ce" stroke-width="90"/><path d="M660 800L920 380" stroke="#b1b99d" stroke-width="100"/>',
 tanks:'<rect width="1200" height="800" fill="#b5c2ba"/><path d="M0 250L120 80L260 230L400 50L600 250L780 70L980 210L1120 80L1200 250V500H0Z" fill="#364638"/><path d="M480 580H1140L1080 740H540Z" fill="#777f7a"/><rect x="700" y="490" width="280" height="100" rx="30" fill="#989f98"/><path d="M800 520L400 440" stroke="#8d958e" stroke-width="40"/>'
};
const manifest=[['officer','Leadership in focus','A dark uniform against a warm beige background.','People','Officer / beige — substitute illustration'],['aerial','A view from above','Bright terrain under a gray sky tests the pale dissolve.','Landscape','Aerial / gray sky — substitute illustration'],['tanks','Equipment and surroundings','Gray equipment and dark trees test chromatic continuity.','Equipment','Tanks / trees — substitute illustration'],['dark','A new chapter','Dark navy imagery exercises the longest dissolve.','Portrait','Dark navy — diagnostic illustration'],['white','Considered design','A white-background product tests the light end of the scale.','Design','White product — diagnostic illustration'],['gray','Lines and light','Grayscale imagery receives a consistent neutral hue.','Architecture','Grayscale — diagnostic illustration'],['yellow','A brighter perspective','Saturated yellow tests the warm-gamut chroma cap.','Color','Saturated yellow — diagnostic illustration']].map(([id,title,description,entity,label])=>({id,title,description,entity,label}));
for(const fixture of manifest) {
 const svg=scenes[fixture.id]?Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">${scenes[fixture.id]}</svg>`):await readFile(new URL(`../../public/tint-demo/${fixture.id}.svg`,import.meta.url));
 await writeFile(new URL(`${fixture.id}.svg`,output),svg);
 const metadata=await buildCardBlendAssets(svg);
 for(const [key,suffix] of [['ambientImage','ambient'],['meltImage','melt']]){await writeFile(new URL(`${fixture.id}-${suffix}.webp`,output),Buffer.from(metadata[key].split(',')[1],'base64'));metadata[key]=`${fixture.id}-${suffix}.webp`;}
 await writeFile(new URL(`${fixture.id}.json`,output),JSON.stringify(metadata,null,2)+'\n');
 console.log(fixture.id,metadata.assetBytes);
}
await writeFile(new URL('manifest.json',output),JSON.stringify(manifest,null,2)+'\n');

// node scripts/images/build-card-blend.mjs input-image output-prefix
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {buildCardBlendAssets} from '../../src/images/card-blend/assets.js';
const [input,prefix]=process.argv.slice(2);
if(!input||!prefix)throw new Error('Usage: build-card-blend.mjs input-image output-prefix');
await mkdir(path.dirname(prefix),{recursive:true});
const result=await buildCardBlendAssets(await readFile(input));
for(const [key,suffix] of [['ambientImage','ambient'],['meltImage','melt']]) {
    await writeFile(`${prefix}-${suffix}.webp`,Buffer.from(result[key].split(',')[1],'base64'));
    result[key]=`${path.basename(prefix)}-${suffix}.webp`;
}
await writeFile(`${prefix}.json`,JSON.stringify(result,null,2)+'\n');

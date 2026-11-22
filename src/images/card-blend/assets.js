import sharp from 'sharp';
import {normalizeMelt} from './melt.js';
import { areaLabGrid, normalizeAmbient } from '../../../public/card-blend/color.js';
const dataUrl=bytes=>`data:image/webp;base64,${bytes.toString('base64')}`;
export async function buildCardBlendAssets(buffer) {
    const image=sharp(buffer,{limitInputPixels:40_000_000,animated:false}).rotate().toColourspace('srgb').removeAlpha();
    const {data,info}=await image.clone().raw().toBuffer({resolveWithObject:true});
    const normalized=normalizeAmbient(areaLabGrid(data,info.width,info.height,info.channels));
    const raw=Buffer.from(normalized.cells.flatMap(cell=>cell.rgb));
    const ambient=await sharp(raw,{raw:{width:24,height:16,channels:3}})
        .resize(96,64,{kernel:'cubic'}).blur(3).webp({quality:80}).toBuffer();
    const blurred=await image.clone().resize({width:320}).blur(6).raw().toBuffer({resolveWithObject:true});
    const pixels=normalizeMelt(blurred.data,blurred.info.width,blurred.info.height,normalized.cells);
    const melt=await sharp(pixels,{raw:{width:blurred.info.width,height:blurred.info.height,channels:3}}).webp({quality:80}).toBuffer();
    const {cells,...metadata}=normalized;
    return {...metadata, ambientImage:dataUrl(ambient),meltImage:dataUrl(melt),
        assetBytes:{ambient:ambient.length,melt:melt.length}};
}

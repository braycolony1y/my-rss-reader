import {rgbToOklab,hueOf,hueDistance} from '../../../public/card-blend/color.js';
export function measureCard(data,info,geometry,metadata) {
    const {card,plate,heading,fy,mobile,expanded}=geometry;
    const rgb=(x,y)=>{const i=(Math.max(0,Math.min(info.height-1,Math.round(y*2)))*info.width+Math.max(0,Math.min(info.width-1,Math.round(x*2))))*info.channels;return [...data.subarray(i,i+3)]};
    const color=(x,y)=>{const values=rgb(x,y),[L,a,b]=rgbToOklab(...values);return {x,y,L,C:Math.hypot(a,b),H:hueOf(a,b)}};
    const line=(start,end,fixed,vertical=false)=>{const result=[];for(let p=start;p<=end;p+=4){const value=vertical?color(fixed,p):color(p,fixed);value.deltaL=result.length?value.L-result.at(-1).L:0;result.push(value);}return result};
    const end=.50+.10*metadata.k;
    const horizontal=mobile?[]:[.18,.4,.65].map(y=>line(plate.x+plate.width*.18,plate.x+plate.width*end,plate.y+plate.height*y));
    const bottom=geometry.bottom?[.65,.85].map(x=>line(plate.y+plate.height-fy,plate.y+plate.height-2,plate.x+plate.width*x,true)):[];
    const samples=[...horizontal,...bottom];
    const maxStep=Math.max(0,...samples.flat().map(p=>Math.abs(p.deltaL)));
    const midpointRatios=horizontal.map(points=>points[Math.floor(points.length/2)].C/Math.max(.0001,Math.min(points[0].C,points.at(-1).C)));
    const surface=color(heading.x+24,heading.y+heading.height*.5);
    const ambient=color(plate.x+plate.width*.08,plate.y+plate.height*.42);
    const linear=v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4;
    const luminance=c=>c.map(linear).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const contrasts=geometry.ink.flatMap(ink=>[.15,.5,.85].flatMap(y=>[.15,.5,.85].map(x=>{const bg=luminance(rgb(heading.x+heading.width*x,heading.y+heading.height*y)),fg=luminance(ink);return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)})));
    const hueErrors=horizontal.flatMap(points=>points.filter(p=>p.C>=.02).map(p=>hueDistance(p.H,ambient.H)));
    const checks={textTintChroma:surface.C>=.03,ambientChroma:ambient.C>=.05&&ambient.C<=.085,
        lightnessStep:maxStep<=.035,noLargeStep:maxStep<=.06,chromaMidpoint:midpointRatios.every(r=>r>=.7),
        seamHue:hueErrors.every(error=>error<=15),bottomLength:!geometry.bottom||fy>=140,
        tintFlow:Math.abs(surface.L-ambient.L)>=.02&&Math.abs(surface.L-ambient.L)<=.05,
        contrastAA:Math.min(...contrasts)>=4.5,entitySpan:mobile||Math.abs(geometry.entityBottom-(plate.y+plate.height))<=1,
        noRuntimeBlur:geometry.noRuntimeBlur,oneBackdrop:geometry.backdrops<=1};
    return {fixture:geometry.fixture,width:Math.round(card.width),expanded,mobile,
        measurements:{maxStep,minimumChromaRatio:Math.min(...midpointRatios),maximumHueError:Math.max(0,...hueErrors),minimumContrast:Math.min(...contrasts),fy,textTint:surface,ambient,tintSpread:Math.abs(surface.L-ambient.L)},
        checks,pass:Object.values(checks).every(Boolean),samples};
}

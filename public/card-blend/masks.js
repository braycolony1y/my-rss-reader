export const SMOOTHERSTEP = Object.freeze([0,.00856,.05792,.16308,.31744,.5,.68256,.83692,.94208,.99144,1]);
export function ramp(direction, start, end, unit = '%') {
    return `linear-gradient(${direction},${SMOOTHERSTEP.map((alpha,i)=>`rgba(0,0,0,${alpha}) ${start+(end-start)*i/10}${unit}`).join(',')})`;
}
export function variableRamp(direction, variable, extra = 0) {
    return `linear-gradient(${direction},${SMOOTHERSTEP.map((alpha,i)=>`rgba(0,0,0,${alpha}) calc((${variable} + ${extra}px) * ${i/10})`).join(',')})`;
}
export function maskProperties(k = 0) {
    k=Math.max(0,Math.min(1,k));
    return {'--plate-x':ramp('to right',18,50+10*k), '--melt-x':ramp('to right',0,40+10*k),
        '--plate-y':variableRamp('to top','var(--fy)'), '--melt-y':variableRamp('to top','var(--fy)',24),
        '--ambient-x':ramp('to right',0,45), '--ambient-y':ramp('to top',0,160,'px')};
}

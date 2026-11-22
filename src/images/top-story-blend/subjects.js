import * as ort from 'onnxruntime-node';
import { fileURLToPath } from 'node:url';
import { spectralFocalPoint } from '../../../public/top-story-card/blend/saliency.js';
let sessionPromise;
const clamp = n => Math.max(0, Math.min(1, n));
export async function detectStorySubjects(image) {
    const rgb = await image.clone().resize(320, 240, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const plane = 320 * 240, input = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (rgb[i * 3 + c] - 127) / 128;
    process.env.ORT_DISABLE_TELEMETRY = '1';
    sessionPromise ||= ort.InferenceSession.create(fileURLToPath(new URL('../models/ultraface-rfb-320.onnx', import.meta.url)),
        { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1, logSeverityLevel: 3 }).catch(e => { sessionPromise = null; throw e; });
    const session = await sessionPromise;
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 240, 320]) });
    const candidates = [];
    for (let i = 0; i < output.scores.data.length / 2; i++) {
        const confidence = output.scores.data[i * 2 + 1];
        if (confidence < .75) continue;
        const [left, top, right, bottom] = Array.from(output.boxes.data.slice(i * 4, i * 4 + 4), clamp);
        const area = (right - left) * (bottom - top);
        if (right <= left || bottom <= top || area < .0005 || area > .003 && confidence < .90) continue;
        candidates.push({ left, top, right, bottom, confidence });
    }
    const faces = [];
    for (const c of candidates.sort((a, b) => b.confidence - a.confidence)) {
        const duplicate = faces.some(f => {
            const intersection = Math.max(0, Math.min(c.right, f.right) - Math.max(c.left, f.left)) * Math.max(0, Math.min(c.bottom, f.bottom) - Math.max(c.top, f.top));
            return intersection / Math.min((c.right - c.left) * (c.bottom - c.top), (f.right - f.left) * (f.bottom - f.top)) > .5;
        });
        if (!duplicate) faces.push(c);
    }
    return faces;
}

export async function storyFocalBox(image, faces = []) {
    if (faces.length) {
        const left = Math.min(...faces.map(f => f.left)), right = Math.max(...faces.map(f => f.right));
        const top = Math.min(...faces.map(f => f.top)), bottom = Math.max(...faces.map(f => f.bottom));
        const w = right - left, h = bottom - top;
        return { x: (left + right) / 2, y: (top + bottom) / 2, w: Math.min(1, w * 1.3), h: Math.min(1, h * 1.3), kind: 'face' };
    }
    const stats = await image.clone().stats();
    if (stats.entropy < .1) return { x: .5, y: .4, w: .18, h: .18, kind: 'default' };
    const pixels = await image.clone().resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    return { ...spectralFocalPoint(pixels), w: .18, h: .18, kind: 'saliency' };
}

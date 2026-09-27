import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { fileURLToPath } from 'node:url';

const clamp = value => Math.max(0, Math.min(1, value));
let sessionPromise;

function faceSession() {
    if (!sessionPromise) {
        // Local image analysis must not start the runtime's telemetry uploader
        // or leave telemetry state in the application's working directory.
        process.env.ORT_DISABLE_TELEMETRY = '1';
        sessionPromise = ort.InferenceSession.create(
            fileURLToPath(new URL('./models/ultraface-rfb-320.onnx', import.meta.url)),
            { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1, logSeverityLevel: 3 }
        ).catch(error => { sessionPromise = null; throw error; });
    }
    return sessionPromise;
}

export function selectFace(scores, boxes) {
    const candidates = [];
    for (let i = 0; i < scores.length / 2; i++) {
        const confidence = scores[i * 2 + 1];
        if (confidence < 0.75) continue;
        const [left, top, right, bottom] = Array.from(boxes.slice(i * 4, i * 4 + 4), clamp);
        const area = (right - left) * (bottom - top);
        if (right <= left || bottom <= top || area < 0.0005) continue;
        const x = (left + right) / 2;
        const y = (top + bottom) / 2;
        // Area dominates; confidence and centrality break near ties. Selecting
        // one face means duplicate overlapping detections need no group NMS.
        const rank = Math.sqrt(area) * confidence * (1 - 0.2 * Math.hypot(x - 0.5, y - 0.5));
        candidates.push({ x, y, type: 'face', confidence, bounds: { left, top, right, bottom }, rank });
    }
    candidates.sort((a, b) => b.rank - a.rank);
    if (!candidates.length) return null;
    const { rank, ...face } = candidates[0];
    return face;
}

export async function detectImageFocus(buffer) {
    // Decode only the first frame, honour EXIF orientation, and bound decompression.
    const image = sharp(buffer, { limitInputPixels: 40_000_000, animated: false }).rotate().removeAlpha().toColourspace('srgb');
    const { data, info } = await image.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
        .raw().toBuffer({ resolveWithObject: true });
    const decoded = sharp(data, { raw: info });
    const rgb = await decoded.clone().resize(320, 240, { fit: 'fill' }).raw().toBuffer();
    const plane = 320 * 240;
    const input = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) {
        for (let c = 0; c < 3; c++) input[c * plane + i] = (rgb[i * 3 + c] - 127) / 128;
    }
    const session = await faceSession();
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 240, 320]) });
    const face = selectFace(output.scores.data, output.boxes.data);
    if (face) return face;

    const stats = await decoded.clone().stats();
    if (stats.entropy < 0.1) return { x: 0.5, y: 0.5, type: 'center', confidence: 0 };
    // libvips attention uses luminance, saturation and skin tones. A square
    // source is required so attention can search in both axes, not only the
    // dimension trimmed by a normal landscape/portrait cover crop.
    const square = await decoded.clone().resize(128, 128, { fit: 'fill' }).png().toBuffer();
    const { info: crop } = await sharp(square).resize(64, 128, { fit: 'cover', position: sharp.strategy.attention, withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true });
    return { x: clamp((crop.attentionX ?? 64) / 128),
        y: clamp((crop.attentionY ?? 64) / 128), type: 'saliency', confidence: 0 };
}

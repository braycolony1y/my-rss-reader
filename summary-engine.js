/**
 * summary-engine.js — AI Summary Engine
 * 
 * Background queue that generates article summaries using Gemini APIs.
 * Uses Gemini for online generation. Local Qwen remains available only to the
 * Smart clustering engine; no Qwen cloud endpoint is used here.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createHash } from 'crypto';
function fnv1a(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
}

const ARTICLE_CACHE_DIR = './article_cache';
const SUMMARY_MAX_INPUT_CHARS = 12000;
const SUMMARY_MAX_INPUT_CHARS_VOZ = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;
const QUEUE_POLL_INTERVAL_MS = 3000;
const COOLDOWN_BETWEEN_JOBS_MS = 1500;
const GEMINI_PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FLASH_LITE_MODEL || 'gemini-3.5-flash-lite';

function logOnlineAiUsage(event) {
    console.log('[ONLINE AI]', JSON.stringify({
        at: new Date().toISOString(),
        provider: 'gemini',
        ...event
    }));
}

// ─── Key Manager ───────────────────────────────────────────────────────

export class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.activeIdx = 0;
        this.autoSwitchCount = 0;
        this.requestStartChain = Promise.resolve();
        this.nextRequestStartAt = 0;
        this.loadKeys();
    }

    loadKeys() {
        try {
            if (fsSync.existsSync('./gemini-keys.txt')) {
                const lines = fsSync.readFileSync('./gemini-keys.txt', 'utf-8')
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 10);
                this.keys = lines.map((k, i) => ({
                    key: k,
                    index: i,
                    status: 'Standby',
                    requestsToday: 0,
                    lastUsed: null,
                    lastError: null
                }));
            }
        } catch(e) {}
        
        if (this.keys.length === 0 && process.env.GEMINI_API_KEY) {
            this.keys.push({
                key: process.env.GEMINI_API_KEY,
                index: 0,
                status: 'Standby',
                requestsToday: 0,
                lastUsed: null,
                lastError: null
            });
        }
        if (this.keys.length > 0) {
            this.keys[0].status = 'Active';
        }
    }

    getCurrentKeyObj() {
        if (this.keys.length === 0) return null;
        
        const now = Date.now();
        this.keys.forEach(k => {
            if (k.status === 'Rate Limited' && k.cooldownUntil && now > k.cooldownUntil) {
                k.status = 'Standby';
                k.cooldownUntil = null;
            }
        });
        
        if (this.keys[this.activeIdx].status === 'Rate Limited' || this.keys[this.activeIdx].status === 'Error') {
            if (!this._switchToNextAvailableKey()) return null;
        }
        
        return this.keys[this.activeIdx];
    }

    _switchToNextAvailableKey() {
        if (!this.keys.length) return false;
        for (let offset = 1; offset <= this.keys.length; offset++) {
            const nextIdx = (this.activeIdx + offset) % this.keys.length;
            if (this.keys[nextIdx].status === 'Rate Limited' || this.keys[nextIdx].status === 'Error') continue;
            this.activeIdx = nextIdx;
            if (this.keys[this.activeIdx].status === 'Standby') {
                this.keys[this.activeIdx].status = 'Active';
            }
            return true;
        }
        return false;
    }

    reportError(errorObj) {
        if (!this.keys.length) return;
        const current = this.keys[this.activeIdx];
        current.lastError = errorObj.message || 'Unknown error';
        current.lastHttpStatus = Number(errorObj.status) || null;
        current.lastErrorAt = new Date().toISOString();
        
        const isQuotaError = errorObj.status === 429 || errorObj.status === 403 || (errorObj.message && errorObj.message.toLowerCase().includes('quota'));
        
        if (isQuotaError) {
            current.status = 'Rate Limited';
            current.cooldownUntil = Date.now() + 15 * 60 * 1000; // 15 minutes cooldown
            this.autoSwitchCount++;
            const switched = this._switchToNextAvailableKey();
            console.log(switched
                ? `[SUMMARY] Gemini API quota hit (${errorObj.status}). Failover to key index ${this.activeIdx}`
                : `[SUMMARY] Gemini API quota hit (${errorObj.status}). All configured keys are cooling down.`);
        } else {
            console.log(`[SUMMARY] Gemini API error (${errorObj.status || 'Network/Timeout'}). Retrying same key.`);
        }
    }

    recordUsage() {
        if (!this.keys.length) return;
        const current = this.keys[this.activeIdx];
        current.requestsToday++;
        current.lastUsed = Date.now();
        current.status = 'Active';
    }

    async waitForRateSlot(minIntervalMs = 6000) {
        const waitForSlot = this.requestStartChain.then(async () => {
            // Re-check after waking because a 429 response can extend the shared
            // deadline while another request is already asleep in this queue.
            while (true) {
                const now = Date.now();
                const hasAvailableKey = this.keys.some(key => key.status !== 'Error'
                    && (key.status !== 'Rate Limited' || !key.cooldownUntil || now > key.cooldownUntil));
                if (!hasAvailableKey) return;
                const delay = Math.max(0, this.nextRequestStartAt - Date.now());
                if (delay <= 0) break;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            this.nextRequestStartAt = Date.now() + Math.max(1000, Number(minIntervalMs) || 6000);
        });
        this.requestStartChain = waitForSlot.catch(() => {});
        return waitForSlot;
    }

    deferRequests(delayMs) {
        const delay = Math.max(0, Number(delayMs) || 0);
        this.nextRequestStartAt = Math.max(this.nextRequestStartAt, Date.now() + delay);
    }

    reportSharedRateLimit(errorObj, cooldownMs = 15 * 60 * 1000) {
        const until = Date.now() + Math.max(60000, Number(cooldownMs) || 0);
        for (const key of this.keys) {
            key.status = 'Rate Limited';
            key.cooldownUntil = until;
            key.lastError = errorObj?.message || 'Shared project quota exceeded';
            key.lastHttpStatus = Number(errorObj?.status) || 429;
            key.lastErrorAt = new Date().toISOString();
        }
        this.deferRequests(cooldownMs);
    }

    getDebugStats() {
        return {
            activeKeyIndex: this.activeIdx,
            activeKeyMasked: this.keys.length ? `${this.keys[this.activeIdx].key.substring(0, 10)}...` : 'None',
            totalKeys: this.keys.length,
            autoSwitchCount: this.autoSwitchCount,
            keys: this.keys.map(k => ({
                index: k.index,
                label: `Key ${k.index + 1}`,
                status: k.status,
                requestsToday: k.requestsToday,
                lastUsed: k.lastUsed,
                lastError: k.lastError,
                lastErrorAt: k.lastErrorAt || null,
                lastHttpStatus: k.lastHttpStatus || null,
                cooldownUntil: k.cooldownUntil ? new Date(k.cooldownUntil).toISOString() : null
            }))
        };
    }
}

const geminiKeyManager = new GeminiKeyManager();

// ─── Language Detection ────────────────────────────────────────────────

const VIETNAMESE_MARKERS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const VIETNAMESE_WORDS = /\b(?:của|và|các|được|trong|này|có|không|cho|với|từ|là|một|người|những|đã|sẽ|để|theo|về|đến|nhiều|cũng|thì|tại|khi|nếu|như|nhưng|vì|hay|hoặc|mà|tuy|rằng|bởi|nên|vậy|nào)\b/gi;

function detectLanguage(text) {
    if (!text || text.length < 20) return 'en';
    const sample = text.slice(0, 3000);
    const viCharMatches = (sample.match(VIETNAMESE_MARKERS) || []).length;
    const viWordMatches = (sample.match(VIETNAMESE_WORDS) || []).length;
    if (viCharMatches > 5 || viWordMatches > 8) return 'vi';
    return 'en';
}

// ─── Gemini Client ─────────────────────────────────────────────────────

async function geminiGenerate(model, prompt, options = {}) {
    await geminiKeyManager.waitForRateSlot(6000);
    const keyObj = geminiKeyManager.getCurrentKeyObj();
    if (!keyObj) throw new Error("No Gemini API key available");
    geminiKeyManager.recordUsage();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyObj.key}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    
    const startTime = Date.now();
    let usageLogged = false;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: options.maxTokens || 800
                }
            }),
            signal: controller.signal
        });
        
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
            err.status = res.status;
            logOnlineAiUsage({
                operation: options.operation || 'summary',
                model,
                keyIndex: Number(keyObj.index) + 1,
                status: 'failed',
                httpStatus: res.status,
                durationMs: Date.now() - startTime
            });
            usageLogged = true;
            geminiKeyManager.reportError(err);
            throw err;
        }
        
        const data = await res.json();
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error("Invalid Gemini response format");
        }

        logOnlineAiUsage({
            operation: options.operation || 'summary',
            model,
            keyIndex: Number(keyObj.index) + 1,
            status: 'success',
            httpStatus: res.status,
            durationMs: Date.now() - startTime,
            promptTokens: Number(data.usageMetadata?.promptTokenCount) || 0,
            outputTokens: Number(data.usageMetadata?.candidatesTokenCount) || 0,
            totalTokens: Number(data.usageMetadata?.totalTokenCount) || 0
        });
        usageLogged = true;
        
        return {
            text: data.candidates[0].content.parts[0].text,
            totalDuration: (Date.now() - startTime) * 1e6,
            provider: 'gemini'
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            const err = new Error('Request timed out');
            err.status = 504;
            logOnlineAiUsage({
                operation: options.operation || 'summary',
                model,
                keyIndex: Number(keyObj.index) + 1,
                status: 'failed',
                httpStatus: 504,
                durationMs: Date.now() - startTime
            });
            usageLogged = true;
            geminiKeyManager.reportError(err);
            throw err;
        }
        if (!usageLogged) {
            logOnlineAiUsage({
                operation: options.operation || 'summary',
                model,
                keyIndex: Number(keyObj.index) + 1,
                status: 'failed',
                httpStatus: Number(error.status) || null,
                durationMs: Date.now() - startTime,
                errorCode: String(error.code || error.name || 'UNKNOWN').slice(0, 80)
            });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function generateWithFallback(geminiModel, prompt, options = {}) {
    const { maxTokens = 1500, timeoutMs = 120000 } = options;
    const globalTimeout = Date.now() + timeoutMs;

    const primaryModel = geminiModel || GEMINI_PRIMARY_MODEL;
    const sequence = [
        { displayModel: primaryModel, apiModel: primaryModel, timeout: 40000 },
        ...(GEMINI_FALLBACK_MODEL === primaryModel ? [] : [{
            displayModel: GEMINI_FALLBACK_MODEL,
            apiModel: GEMINI_FALLBACK_MODEL,
            timeout: 30000
        }])
    ];
    
    let fallbackTrace = [];
    let lastError = null;

    for (const step of sequence) {
        if (Date.now() > globalTimeout) break;
        
        try {
            const res = await geminiGenerate(step.apiModel, prompt, {
                maxTokens,
                timeoutMs: step.timeout,
                operation: options.operation || 'summary'
            });
            res.provider = 'gemini';
            res.modelUsed = step.displayModel;
            res.fallbackTrace = fallbackTrace;
            return res;
        } catch (e) {
            console.log(`[SUMMARY] Model ${step.displayModel} failed: ${e.message}`);
            fallbackTrace.push({ model: step.displayModel, status: 'failed', reason: e.message });
            lastError = e;
        }
    }
    
    throw new Error(`All providers failed sequentially. Trace: ${JSON.stringify(fallbackTrace)}`);
}

// ─── Prompts ───────────────────────────────────────────────────────────

function buildSummaryPrompt(text, language, metadata = {}) {
    const articleLength = text.length;
    const isShort = articleLength < 1500;
    const isLong = articleLength > 6000;

    if (language === 'vi') {
        return `Bạn là trợ lý AI chuyên tóm tắt bài báo. Hãy tóm tắt bài viết dưới đây bằng tiếng Việt.

Yêu cầu:
- Viết 1 câu tóm tắt tổng quan (TL;DR)
- Liệt kê ${isShort ? '2-3' : isLong ? '4-6' : '3-5'} điểm chính quan trọng nhất
- Giữ nguyên tên riêng, số liệu, ngày tháng, địa danh
- Trung lập, khách quan, không clickbait
- Mỗi điểm chính viết ngắn gọn, dễ hiểu
${metadata.title ? `\nTiêu đề: ${metadata.title}` : ''}
${metadata.siteName ? `Nguồn: ${metadata.siteName}` : ''}

Trả lời theo format:
TLDR: [tóm tắt 1 câu]

KEY_POINTS:
- [điểm 1]
- [điểm 2]
- [điểm 3]${isLong ? '\n- [điểm 4]\n- [điểm 5]' : ''}

Nội dung bài viết:
${text}`;
    }

    return `You are an AI assistant that summarizes articles. Summarize the article below.

Requirements:
- Write 1 TL;DR sentence
- List ${isShort ? '2-3' : isLong ? '4-6' : '3-5'} key takeaways
- Preserve proper nouns, numbers, dates, and locations
- Stay neutral, factual, no clickbait
- Keep each point concise and scannable
${metadata.title ? `\nTitle: ${metadata.title}` : ''}
${metadata.siteName ? `Source: ${metadata.siteName}` : ''}

Respond in this exact format:
TLDR: [one-sentence summary]

KEY_POINTS:
- [point 1]
- [point 2]
- [point 3]${isLong ? '\n- [point 4]\n- [point 5]' : ''}

Article content:
${text}`;
}

function buildVozThreadPrompt(posts, language, metadata = {}) {
    const postsText = posts.map((p, i) => `[Post #${p.number || i + 1}${p.author ? ` by ${p.author}` : ''}]: ${p.content}`).join('\n\n');
    const isFast = metadata.fastMode === true;

    if (language === 'vi') {
        return `Bạn là trợ lý AI chuyên tóm tắt thảo luận trên diễn đàn. Hãy tóm tắt thread dưới đây bằng tiếng Việt.

Yêu cầu:
- Tóm tắt tổng quan thread ${isFast ? '(súc tích)' : ''}
${!isFast ? '- Các chủ đề thảo luận chính\n- Thông tin quan trọng được chia sẻ\n- Ý kiến đáng chú ý\n- Kết luận/đồng thuận chung (nếu có)' : '- Ghi nhận 2-3 điểm chính'}
- Giữ nguyên tên riêng, số liệu
${metadata.title ? `\nTiêu đề thread: ${metadata.title}` : ''}

Trả lời theo format:
TLDR: [tóm tắt thành 1 đoạn văn ngắn gọn]

KEY_POINTS:
- [chủ đề/điểm chính 1]
- [chủ đề/điểm chính 2]
${!isFast ? '- [chủ đề/điểm chính 3]\n- [chủ đề/điểm chính 4]\n- [chủ đề/điểm chính 5]' : ''}

DISCUSSION:
[Phân tích thảo luận ${isFast ? 'súc tích khoảng 2 câu' : 'chi tiết hơn, 2-4 câu'}]

Nội dung thảo luận:
${postsText}`;
    }

    return `You are an AI assistant that summarizes forum discussions. Summarize the thread below.

Requirements:
- Thread overview
- Main discussion topics
- Key information shared
- Notable opinions
- Community consensus (if any)
- Preserve proper nouns and data
${metadata.title ? `\nThread title: ${metadata.title}` : ''}

Respond in this exact format:
TLDR: [1 concise paragraph summary]

KEY_POINTS:
- [topic/point 1]
- [topic/point 2]
- [topic/point 3]
- [topic/point 4]
- [topic/point 5]

DISCUSSION:
[More detailed analysis, 2-4 sentences]

Thread content:
${postsText}`;
}

function buildAnalysisPrompt(text, language, metadata = {}) {
    if (language === 'vi') {
        return `Bạn là một chuyên gia giải thích tin tức. Hãy phân tích, chia nhỏ và giải thích bài báo dưới đây bằng tiếng Việt để người đọc bình thường có thể dễ dàng hiểu được.

Yêu cầu:
- Viết các đoạn văn chi tiết (tối thiểu 3-5 đoạn, có thể dài hơn nếu cần thiết).
- BẮT BUỘC SỬ DỤNG định dạng rõ ràng, tách đoạn mạch lạc, và dùng gạch đầu dòng (bullet points) hoặc chữ đậm cho các ý chính để dễ đọc.
- CHỈ SỬ DỤNG thông tin có trong bài báo. Tuyệt đối KHÔNG tự bịa thêm thông tin, KHÔNG đưa thêm kiến thức bên ngoài bài báo vào.
- Giải thích các thuật ngữ khó, bẻ nhỏ các khái niệm phức tạp và tóm tắt rõ ràng các ý chính. Văn phong dễ hiểu, rõ ràng và mạch lạc.
${metadata.title ? `\nTiêu đề: ${metadata.title}` : ''}
${metadata.siteName ? `Nguồn: ${metadata.siteName}` : ''}

Nội dung bài viết:
${text}`;
    }

    return `You are an expert news explainer. Break down and explain the article below so that a general audience can easily understand it.

Requirements:
- Write detailed paragraphs (at least 3-5 paragraphs, can be longer if necessary).
- YOU MUST use clear formatting, spacing, and bullet points or bold text for key insights to make it easy to read.
- ONLY USE information provided in the article. DO NOT invent information and DO NOT bring in outside knowledge or context not found in the text.
- Explain difficult terms, break down complex concepts, and clearly outline the main points. Tone should be simple, clear, and easy to digest.
${metadata.title ? `\nTitle: ${metadata.title}` : ''}
${metadata.siteName ? `Source: ${metadata.siteName}` : ''}

Article content:
${text}`;
}

// ─── Deep Analysis ───────────────────────────────────────────────────────

async function generateDeepAnalysis(url) {
    const cached = await readArticleCache(url);
    if (!cached || !cached.result || !cached.result.content) {
        throw new Error('Article content not found in cache');
    }

    const plainText = stripHtml(cached.result.content).slice(0, SUMMARY_MAX_INPUT_CHARS);
    if (plainText.length < 80) {
        throw new Error('Article too short for deep analysis');
    }

    const language = detectLanguage(plainText);
    const prompt = buildAnalysisPrompt(plainText, language, {
        title: cached.result.title,
        siteName: cached.result.siteName
    });

    console.log(`[ANALYSIS] 🤖 Generating analysis for: ${(cached.result.title || url).slice(0, 60)}...`);

    let analysisText = null;
    let analysisModel = null;
    
    try {
        const result = await generateWithFallback(GEMINI_PRIMARY_MODEL, prompt, {
            maxTokens: 1500,
            timeoutMs: 120000,
            operation: 'deep-analysis'
        });
        analysisText = result.text;
        analysisModel = result.modelUsed;
    } catch (e) {
        console.log(`[ANALYSIS] All models failed: ${e.message}`);
        throw new Error(`All models failed to generate analysis. Last error: ${e.message}`);
    }


    // Save to cache
    if (!cached.summary) cached.summary = { status: 'ready', keyPoints: [], tldr: '' }; // Should ideally exist
    cached.summary.analysis = analysisText;
    cached.summary.analysisModel = analysisModel;
    
    // Write directly to file to avoid race conditions with summaryQueue
    const filename = articleCacheFilename(url);
    const tmpFile = filename + '.tmp.analysis.' + Date.now();
    await fs.writeFile(tmpFile, JSON.stringify(cached));
    await fs.rename(tmpFile, filename);

    return { text: analysisText, model: analysisModel };
}

// ─── Response Parser ───────────────────────────────────────────────────

function parseSummaryResponse(text) {
    const result = { tldr: '', keyPoints: [], discussion: '' };
    if (!text) return result;

    const tldrMatch = text.match(/TLDR:\s*(.+?)(?:\n|$)/i);
    if (tldrMatch) result.tldr = tldrMatch[1].trim();

    const keyPointsSection = text.match(/KEY_POINTS:\s*\n([\s\S]*?)(?:\n\s*(?:DISCUSSION:|$))/i);
    if (keyPointsSection) {
        result.keyPoints = keyPointsSection[1]
            .split('\n')
            .map(line => line.replace(/^\s*[-•*]\s*/, '').trim())
            .filter(line => line.length > 5);
    }

    const discussionMatch = text.match(/DISCUSSION:\s*\n?([\s\S]*?)$/i);
    if (discussionMatch) {
        result.discussion = discussionMatch[1].trim();
    }

    // Fallback
    if (result.keyPoints.length === 0 && result.tldr === '') {
        const lines = text.split('\n').filter(l => l.trim().length > 10);
        if (lines.length > 0) {
            result.tldr = lines[0].replace(/^\s*[-•*]\s*/, '').trim();
            result.keyPoints = lines.slice(1, 6).map(l => l.replace(/^\s*[-•*]\s*/, '').trim());
        }
    }

    return result;
}

// ─── Article Cache Integration ─────────────────────────────────────────

function articleCacheFilename(url) {
    const canonicalUrl = String(url).replace(/\/unread\/?(?:[?#].*)?$/i, '');
    return path.join(ARTICLE_CACHE_DIR, fnv1a(canonicalUrl) + '.json');
}

async function readArticleCache(url) {
    try {
        return JSON.parse(await fs.readFile(articleCacheFilename(url), 'utf-8'));
    } catch {
        return null;
    }
}

async function writeSummaryToCache(url, summaryData) {
    const filename = articleCacheFilename(url);
    try {
        const cached = JSON.parse(await fs.readFile(filename, 'utf-8'));
        cached.summary = summaryData;
        const tmpFile = filename + '.tmp.' + Date.now();
        await fs.writeFile(tmpFile, JSON.stringify(cached));
        await fs.rename(tmpFile, filename);
        return true;
    } catch (e) {
        console.error('[SUMMARY] Failed to write summary to cache:', e.message);
        return false;
    }
}

async function getSummaryFromCache(url) {
    const cached = await readArticleCache(url);
    return cached?.summary || null;
}

// ─── Summary Queue ─────────────────────────────────────────────────────

class SummaryQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.currentJob = null;
        this.paused = false;
        this.started = false;
        this.listeners = new Map();
        this._loopTimer = null;
        this._stats = { generated: 0, failed: 0, skipped: 0 };
        this.lastSuccess = null;
        this.lastError = null;
    }

    enqueue(url, metadata = {}, priority = 2, upgrade = false) {
        if (this.queue.some(j => j.url === url && j.upgrade === upgrade)) return;
        if (this.currentJob?.url === url && this.currentJob?.upgrade === upgrade) return;

        this.queue.push({
            url,
            priority,
            metadata,
            upgrade,
            retries: 0,
            addedAt: Date.now()
        });

        this.queue.sort((a, b) => a.priority - b.priority || a.addedAt - b.addedAt);
    }

    prioritize(url) {
        const index = this.queue.findIndex(j => j.url === url);
        if (index > 0) {
            const [job] = this.queue.splice(index, 1);
            job.priority = 0;
            this.queue.unshift(job);
            console.log(`[SUMMARY] ⚡ Prioritized: ${url.slice(0, 80)}`);
        }
    }

    onComplete(url, callback) {
        if (!this.listeners.has(url)) this.listeners.set(url, []);
        this.listeners.get(url).push(callback);
    }

    removeListener(url) {
        this.listeners.delete(url);
    }

    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            currentUrl: this.currentJob?.url || null,
            paused: this.paused,
            stats: { ...this._stats },
            lastSuccess: this.lastSuccess,
            lastError: this.lastError
        };
    }

    getJobStatus(url) {
        if (this.currentJob?.url === url) {
            return { status: 'generating', priority: this.currentJob.priority, position: 0 };
        }
        const index = this.queue.findIndex(j => j.url === url);
        if (index >= 0) {
            return { status: 'pending', priority: this.queue[index].priority, position: index + 1 };
        }
        return null;
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }

    async start() {
        if (this.started) return;
        this.started = true;
        console.log('[SUMMARY] 🚀 Summary queue started (Gemini Edition)');
        this._processLoop();
    }

    async _processLoop() {
        while (this.started) {
            if (this.paused || this.queue.length === 0) {
                await new Promise(r => setTimeout(r, QUEUE_POLL_INTERVAL_MS));
                continue;
            }

            const job = this.queue.shift();
            if (!job) continue;

            this.processing = true;
            this.currentJob = job;

            try {
                const existing = await getSummaryFromCache(job.url);
                // If it's ready and we're NOT upgrading, or if we ARE upgrading and it's already upgraded.
                if (existing && existing.status === 'ready') {
                    if (!job.upgrade || (job.upgrade && existing.modelUsed === GEMINI_PRIMARY_MODEL)) {
                        this._stats.skipped++;
                        this._notifyListeners(job.url, existing);
                        continue;
                    }
                }

                if (existing && existing.status === 'ready' && job.upgrade) {
                    // Do not destroy the old summary while generating the new one
                    existing.isUpgrading = true;
                    await writeSummaryToCache(job.url, existing);
                } else {
                    await writeSummaryToCache(job.url, {
                        ...(existing || {}),
                        status: 'generating',
                        language: existing?.language || null,
                    });
                }

                const cached = await readArticleCache(job.url);
                if (!cached?.result?.content) {
                    this._stats.skipped++;
                    continue;
                }

                const plainText = stripHtml(cached.result.content).slice(0, SUMMARY_MAX_INPUT_CHARS);
                if (plainText.length < 80) {
                    this._stats.skipped++;
                    await writeSummaryToCache(job.url, { status: 'skipped', reason: 'too_short' });
                    continue;
                }

                const language = detectLanguage(plainText);
                const prompt = buildAnalysisPrompt(plainText, language, {
                    title: cached.result.title || job.metadata.title,
                    siteName: cached.result.siteName || job.metadata.siteName
                });

                console.log(`[SUMMARY] 🤖 Generating Breakdown: ${(cached.result.title || job.url).slice(0, 60)}...`);

                const result = await generateWithFallback(GEMINI_PRIMARY_MODEL, prompt, {
                    maxTokens: 1500,
                    timeoutMs: 120000,
                    operation: 'article-summary'
                });

                const summaryData = {
                    status: 'ready',
                    analysis: result.text,
                    analysisModel: result.modelUsed,
                    language,
                    generatedAt: Date.now(),
                    upgradedAt: null,
                    durationMs: Math.round((result.totalDuration || 0) / 1e6),
                    feedback: existing?.feedback || null,
                    upgraded: false,
                    isUpgrading: false
                };

                await writeSummaryToCache(job.url, summaryData);
                this._stats.generated++;
                this.lastSuccess = Date.now();
                this._notifyListeners(job.url, summaryData);

                console.log(`[SUMMARY] ✅ Done (${summaryData.durationMs}ms): ${(cached.result.title || job.url).slice(0, 60)}`);

            } catch (error) {
                console.error(`[SUMMARY] ❌ Error: ${error.message}`);
                this.lastError = error.message;
                job.retries++;
                if (job.retries <= MAX_RETRIES) {
                    job.priority = 3;
                    this.queue.push(job);
                    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                } else {
                    this._stats.failed++;
                    
                    const existing = await getSummaryFromCache(job.url);
                    if (job.upgrade && existing && existing.status === 'ready' && existing.isUpgrading) {
                        existing.isUpgrading = false;
                        await writeSummaryToCache(job.url, existing);
                        this._notifyListeners(job.url, existing);
                    } else {
                        await writeSummaryToCache(job.url, {
                            status: 'failed',
                            error: error.message.slice(0, 200),
                            language: null,
                            generatedAt: Date.now()
                        });
                        this._notifyListeners(job.url, { status: 'failed', error: error.message });
                    }
                }
            } finally {
                this.processing = false;
                this.currentJob = null;
            }

            await new Promise(r => setTimeout(r, COOLDOWN_BETWEEN_JOBS_MS));
        }
    }

    _notifyListeners(url, data) {
        const cbs = this.listeners.get(url);
        if (cbs) {
            cbs.forEach(cb => { try { cb(data); } catch (e) {} });
            this.listeners.delete(url);
        }
    }
}

// ─── VOZ Thread Summarizer ─────────────────────────────────────────────

async function generateVozThreadSummary(threadUrl, fetchPage, onProgress, signal, options = {}) {
    const allPosts = [];
    let currentUrl = threadUrl.replace(/\/page-\d+/i, '').replace(/\/unread\/?$/i, '');
    let totalPages = null;

    onProgress({ stage: 'crawling', current: 0, total: null, message: 'Starting thread crawl...', threadUrl });

    // Fetch initial page
    if (signal?.aborted) throw new Error('Cancelled');
    const initialPageData = await fetchPage(currentUrl);
    if (!initialPageData) throw new Error('Failed to fetch initial page');
    
    allPosts.push(...extractVozPosts(initialPageData.content));
    totalPages = initialPageData.pagination?.totalPages || 1;
    
    onProgress({
        stage: 'crawling',
        current: 1,
        total: totalPages,
        message: `Collected page 1 of ${totalPages}...`,
        threadUrl
    });

    // Parallel fetch remaining pages in chunks
    if (totalPages > 1) {
        const baseUrl = currentUrl;
        const pageUrls = [];
        for (let i = 2; i <= totalPages; i++) {
            pageUrls.push(`${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${i}`);
        }

        const CHUNK_SIZE = 5;
        for (let i = 0; i < pageUrls.length; i += CHUNK_SIZE) {
            if (signal?.aborted) throw new Error('Cancelled');
            const chunk = pageUrls.slice(i, i + CHUNK_SIZE);
            
            onProgress({
                stage: 'crawling',
                current: i + 1 + chunk.length, // approximation
                total: totalPages,
                message: `Collecting pages ${i + 2} to ${i + 1 + chunk.length} of ${totalPages} (Parallel)...`,
                threadUrl
            });

            const results = await Promise.all(
                chunk.map(url => fetchPage(url).catch(e => {
                    console.error(`[SUMMARY] VOZ chunk error: ${e.message}`);
                    return null;
                }))
            );

            for (const res of results) {
                if (res && res.content) {
                    allPosts.push(...extractVozPosts(res.content));
                }
            }
        }
    }

    if (allPosts.length === 0) {
        throw new Error('No posts found in thread');
    }

    onProgress({
        stage: 'processing',
        current: allPosts.length,
        total: allPosts.length,
        message: `${allPosts.length} posts collected. Deduplicating...`,
        threadUrl
    });

    const dedupedPosts = deduplicateVozQuotes(allPosts);
    const postsText = dedupedPosts.map(p => ({
        number: p.number,
        author: p.author,
        content: p.content.slice(0, 500)
    }));

    let combinedText = postsText.map(p => `[#${p.number}${p.author ? ` ${p.author}` : ''}] ${p.content}`).join('\n');
    if (combinedText.length > SUMMARY_MAX_INPUT_CHARS_VOZ) {
        combinedText = combinedText.slice(0, SUMMARY_MAX_INPUT_CHARS_VOZ);
    }

    const language = detectLanguage(combinedText);
    const model = GEMINI_PRIMARY_MODEL;

    onProgress({
        stage: 'generating',
        current: null,
        total: null,
        message: `Generating summary (${allPosts.length} posts)...`,
        threadUrl
    });

    const prompt = buildVozThreadPrompt(postsText, language, {
        title: threadUrl.split('/').pop()?.replace(/-/g, ' ') || '',
        fastMode: options.fastMode || false
    });

    const result = await generateWithFallback(GEMINI_PRIMARY_MODEL, prompt, {
        maxTokens: 1200,
        timeoutMs: 180000,
        fastMode: options.fastMode || false,
        operation: 'voz-thread-summary'
    });

    const parsed = parseSummaryResponse(result.text);

    return {
        status: 'ready',
        tldr: parsed.tldr,
        keyPoints: parsed.keyPoints,
        discussion: parsed.discussion,
        language,
        modelUsed: result.modelUsed,
        fallbackTrace: result.fallbackTrace,
        rawPosts: dedupedPosts,
        generatedAt: Date.now(),
        durationMs: Math.round((result.totalDuration || 0) / 1e6),
        totalPosts: allPosts.length,
        totalPages: totalPages,
        isVozThread: true,
        feedback: null
    };
}

function extractVozPosts(html) {
    if (!html) return [];
    const posts = [];
    
    const postBlocks = html.split('<article class="message message--post');
    console.log(`[VOZ EXTRACT DEBUG] postBlocks length: ${postBlocks.length}, html length: ${html.length}, html preview: ${html.substring(0, 300).replace(/\n/g, ' ')}`);
    postBlocks.shift();

    for (let block of postBlocks) {
        const authorMatch = block.match(/data-author="([^"]+)"/);
        const idMatch = block.match(/id="js-post-(\d+)"/);
        const bodyMatch = block.match(/<article class="message-body[^>]*>([\s\S]*?)<\/article>/);

        if (authorMatch && idMatch && bodyMatch) {
            posts.push({
                number: parseInt(idMatch[1]),
                author: stripHtml(authorMatch[1]).trim(),
                content: stripHtml(bodyMatch[1]).trim()
            });
        }
    }
    console.log(`[VOZ EXTRACT DEBUG] Extracted ${posts.length} posts`);
    return posts;
}

function deduplicateVozQuotes(posts) {
    return posts.map(post => ({
        ...post,
        content: post.content
            .replace(/(?:Click to expand\.\.\.|Bấm để mở rộng\.\.\.)/g, '')
            .replace(/(.{50,})\n\1/g, '$1')
            .trim()
    }));
}

// ─── Utilities ─────────────────────────────────────────────────────────

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Singleton ─────────────────────────────────────────────────────────

const summaryQueue = new SummaryQueue();

// ─── Automated AI Source Reputation Evaluator ────────────────────────

export async function evaluateSourceReputations(domains) {
    if (!domains || domains.length === 0) return {};
    
    console.log(`[EVALUATOR] Requesting AI evaluation for ${domains.length} source domains...`);
    
    const prompt = `
You are an expert journalism and media analyst. Your task is to assign a "reputation score" to a list of news domains based on their real-world journalistic standards, global/regional reach, and reliability.

Scoring Rubric (Strictly between 0.5 and 1.5):
- 1.15 to 1.50 (Elite): Top-tier global wire services and highly trusted institutions (e.g., reuters.com, apnews.com, bbc.com, bloomberg.com, vnexpress.net, tuoitre.vn).
- 1.10 to 1.14 (High/Mainstream): Major newspapers of record, reputable state media (e.g., nytimes.com, theguardian.com, thanhnien.vn, dantri.com.vn, vietnamnet.vn).
- 1.00 to 1.09 (Standard): Standard commercial news, popular aggregators, acceptable tech/finance sites (e.g., foxnews.com, znews.vn, kenh14.vn).
- 0.50 to 0.99 (Niche/Low): Niche blogs, highly biased or sensationalist tabloids, or very small local outlets (e.g., zerohedge.com, techz.vn, 24h.com.vn).

Output strictly in JSON format as a single object where keys are the domains and values are the float scores. Do not include markdown blocks or any other text.

Domains to evaluate:
${domains.join(', ')}
`;

    try {
        const result = await generateWithFallback(GEMINI_PRIMARY_MODEL, prompt, {
            maxTokens: 4000,
            timeoutMs: 60000,
            operation: 'source-discovery'
        });
        if (!result || !result.content) throw new Error("Empty response from AI");
        
        let jsonStr = result.content;
        // Clean markdown if present
        if (jsonStr.startsWith('```')) {
            const lines = jsonStr.split('\n');
            if (lines[0].includes('json')) lines.shift();
            else if (lines[0].startsWith('```')) lines.shift();
            if (lines[lines.length - 1].startsWith('```')) lines.pop();
            jsonStr = lines.join('\n').trim();
        }
        
        const scores = JSON.parse(jsonStr);
        console.log(`[EVALUATOR] Successfully evaluated ${Object.keys(scores).length} domains.`);
        return scores;
    } catch (err) {
        console.error('[EVALUATOR] AI Evaluation failed:', err.message);
        return null;
    }
}

export {
    summaryQueue,
    geminiKeyManager,
    getSummaryFromCache,
    writeSummaryToCache,
    generateVozThreadSummary,
    detectLanguage,
    stripHtml as stripHtmlForSummary,
    generateDeepAnalysis
};

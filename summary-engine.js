/**
 * summary-engine.js — AI Summary Engine
 * 
 * Background queue that generates article summaries using Gemini APIs.
 * Uses gemini-3.5-flash-lite by default, and gemini-3.5-flash for VOZ or upgrades.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const ARTICLE_CACHE_DIR = './article_cache';
const SUMMARY_MAX_INPUT_CHARS = 12000;
const SUMMARY_MAX_INPUT_CHARS_VOZ = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;
const QUEUE_POLL_INTERVAL_MS = 3000;
const COOLDOWN_BETWEEN_JOBS_MS = 1500;

// ─── Key Manager ───────────────────────────────────────────────────────

class GeminiKeyManager {
    constructor() {
        this.keys = [];
        this.activeIdx = 0;
        this.autoSwitchCount = 0;
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
            this._switchToNextAvailableKey();
        }
        
        return this.keys[this.activeIdx];
    }

    _switchToNextAvailableKey() {
        if (!this.keys.length) return;
        let nextIdx = (this.activeIdx + 1) % this.keys.length;
        let startIndex = nextIdx;
        while (this.keys[nextIdx].status === 'Rate Limited' || this.keys[nextIdx].status === 'Error') {
            nextIdx = (nextIdx + 1) % this.keys.length;
            if (nextIdx === startIndex) break; // All keys are exhausted, stick to current
        }
        this.activeIdx = nextIdx;
        if (this.keys[this.activeIdx].status === 'Standby') {
             this.keys[this.activeIdx].status = 'Active';
        }
    }

    reportError(errorObj) {
        if (!this.keys.length) return;
        const current = this.keys[this.activeIdx];
        current.lastError = errorObj.message || 'Unknown error';
        
        const isQuotaError = errorObj.status === 429 || errorObj.status === 403 || (errorObj.message && errorObj.message.toLowerCase().includes('quota'));
        
        if (isQuotaError) {
            current.status = 'Rate Limited';
            current.cooldownUntil = Date.now() + 15 * 60 * 1000; // 15 minutes cooldown
            this.autoSwitchCount++;
            this._switchToNextAvailableKey();
            console.log(`[SUMMARY] Gemini API quota hit (${errorObj.status}). Failover to key index ${this.activeIdx}`);
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
                lastError: k.lastError
            }))
        };
    }
}

const geminiKeyManager = new GeminiKeyManager();

class QwenKeyManager extends GeminiKeyManager {
    constructor() {
        super();
    }
    
    loadKeys() {
        try {
            if (fsSync.existsSync('./qwen-keys.txt')) {
                const lines = fsSync.readFileSync('./qwen-keys.txt', 'utf-8')
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
        
        if (this.keys.length === 0 && process.env.QWEN_API_KEY) {
            this.keys.push({
                key: process.env.QWEN_API_KEY,
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
    
    reportError(errorObj) {
        if (!this.keys.length) return;
        const current = this.keys[this.activeIdx];
        current.lastError = errorObj.message || 'Unknown error';
        
        const isQuotaError = errorObj.status === 429 || errorObj.status === 403 || errorObj.status === 402 || (errorObj.message && errorObj.message.toLowerCase().includes('quota') || errorObj.message.toLowerCase().includes('balance'));
        
        if (isQuotaError) {
            current.status = 'Rate Limited';
            current.cooldownUntil = Date.now() + 15 * 60 * 1000;
            this.autoSwitchCount++;
            this._switchToNextAvailableKey();
            console.log(`[SUMMARY] Qwen API quota hit (${errorObj.status}). Failover to key index ${this.activeIdx}`);
        } else {
            console.log(`[SUMMARY] Qwen API error (${errorObj.status || 'Network/Timeout'}). Retrying same key.`);
        }
    }
}

const qwenKeyManager = new QwenKeyManager();

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
    const keyObj = geminiKeyManager.getCurrentKeyObj();
    if (!keyObj) throw new Error("No Gemini API key available");
    
    geminiKeyManager.recordUsage();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyObj.key}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    
    const startTime = Date.now();
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: options.maxTokens || 800
                }
            }),
            signal: controller.signal
        });
        
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
            err.status = res.status;
            geminiKeyManager.reportError(err);
            throw err;
        }
        
        const data = await res.json();
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error("Invalid Gemini response format");
        }
        
        return {
            text: data.candidates[0].content.parts[0].text,
            totalDuration: (Date.now() - startTime) * 1e6,
            provider: 'gemini'
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            const err = new Error('Request timed out');
            err.status = 504;
            geminiKeyManager.reportError(err);
            throw err;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function qwenGenerate(model, prompt, options = {}) {
    const keyObj = qwenKeyManager.getCurrentKeyObj();
    if (!keyObj) throw new Error("No Qwen API key available");
    
    qwenKeyManager.recordUsage();
    const url = `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    
    const startTime = Date.now();
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${keyObj.key}`
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: options.maxTokens || 800
            }),
            signal: controller.signal
        });
        
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const err = new Error(`Qwen HTTP ${res.status}: ${body.slice(0, 200)}`);
            err.status = res.status;
            qwenKeyManager.reportError(err);
            throw err;
        }
        
        const data = await res.json();
        if (!data.choices?.[0]?.message?.content) {
            throw new Error("Invalid Qwen response format");
        }
        
        return {
            text: data.choices[0].message.content,
            totalDuration: (Date.now() - startTime) * 1e6,
            provider: 'qwen'
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            const err = new Error('Request timed out');
            err.status = 504;
            qwenKeyManager.reportError(err);
            throw err;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function generateWithFallback(geminiModel, prompt, options = {}) {
    // Map the requested Gemini model to Qwen
    const qwenModel = 'qwen3.5-flash';
    
    let lastError = null;
    try {
        // Try Qwen first
        if (qwenKeyManager.keys.length > 0) {
            return await qwenGenerate(qwenModel, prompt, options);
        } else {
            throw new Error("No Qwen keys configured");
        }
    } catch (error) {
        console.log(`[SUMMARY] Qwen generation failed (${error.message}). Falling back to Gemini...`);
        lastError = error;
    }
    
    // Fallback to Gemini
    try {
        return await geminiGenerate(geminiModel, prompt, options);
    } catch (error) {
        throw new Error(`Both Qwen and Gemini failed. Qwen Error: ${lastError?.message} | Gemini Error: ${error.message}`);
    }
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

    if (language === 'vi') {
        return `Bạn là trợ lý AI chuyên tóm tắt thảo luận trên diễn đàn. Hãy tóm tắt thread dưới đây bằng tiếng Việt.

Yêu cầu:
- Tóm tắt tổng quan thread
- Các chủ đề thảo luận chính
- Thông tin quan trọng được chia sẻ
- Ý kiến đáng chú ý
- Kết luận/đồng thuận chung (nếu có)
- Giữ nguyên tên riêng, số liệu
${metadata.title ? `\nTiêu đề thread: ${metadata.title}` : ''}

Trả lời theo format:
TLDR: [tóm tắt 1-2 câu]

KEY_POINTS:
- [chủ đề/điểm chính 1]
- [chủ đề/điểm chính 2]
- [chủ đề/điểm chính 3]
- [chủ đề/điểm chính 4]
- [chủ đề/điểm chính 5]

DISCUSSION:
[Phân tích thảo luận chi tiết hơn, 2-4 câu]

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
TLDR: [1-2 sentence summary]

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
    let lastError = null;

    // 1. Try qwen-plus
    try {
        if (qwenKeyManager.keys.length > 0) {
            const result = await qwenGenerate('qwen-plus', prompt, { maxTokens: 1500, timeoutMs: 90000 });
            analysisText = result.text;
            analysisModel = 'qwen-plus';
        }
    } catch (e) {
        console.log(`[ANALYSIS] qwen-plus failed: ${e.message}`);
        lastError = e;
    }

    // 2. Try qwen3.6-flash
    if (!analysisText) {
        try {
            if (qwenKeyManager.keys.length > 0) {
                const result = await qwenGenerate('qwen3.6-flash', prompt, { maxTokens: 1500, timeoutMs: 90000 });
                analysisText = result.text;
                analysisModel = 'qwen3.6-flash';
            }
        } catch (e) {
            console.log(`[ANALYSIS] qwen3.6-flash failed: ${e.message}`);
            lastError = e;
        }
    }

    // 3. Try gemini-3.5-flash
    if (!analysisText) {
        try {
            const result = await geminiGenerate('gemini-3.5-flash', prompt, { maxTokens: 1500, timeoutMs: 90000 });
            analysisText = result.text;
            analysisModel = 'gemini-3.5-flash';
        } catch (e) {
            console.log(`[ANALYSIS] gemini-3.5-flash failed: ${e.message}`);
            throw new Error(`All models failed to generate analysis. Last error: ${e.message}`);
        }
    }

    if (!analysisText) throw new Error('Analysis text was empty');

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
    return path.join(ARTICLE_CACHE_DIR, createHash('sha256').update(canonicalUrl).digest('hex') + '.json');
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
                    if (!job.upgrade || (job.upgrade && existing.modelUsed === 'gemini-3.5-flash')) {
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

                let result = null;
                // Try models in order: qwen-plus -> qwen3.6-flash -> gemini-3.5-flash
                if (qwenKeyManager.keys.length > 0) {
                    try {
                        result = await qwenGenerate('qwen-plus', prompt, { maxTokens: 1500, timeoutMs: 90000 });
                        result.provider = 'qwen';
                        result.modelUsed = 'qwen-plus';
                    } catch (e) {
                        console.log(`[SUMMARY] qwen-plus failed: ${e.message}`);
                    }
                    if (!result) {
                        try {
                            result = await qwenGenerate('qwen3.6-flash', prompt, { maxTokens: 1500, timeoutMs: 90000 });
                            result.provider = 'qwen';
                            result.modelUsed = 'qwen3.6-flash';
                        } catch (e) {
                            console.log(`[SUMMARY] qwen3.6-flash failed: ${e.message}`);
                        }
                    }
                }
                
                if (!result) {
                    result = await geminiGenerate('gemini-3.5-flash', prompt, { maxTokens: 1500, timeoutMs: 90000 });
                    result.provider = 'gemini';
                    result.modelUsed = 'gemini-3.5-flash';
                }

                if (!result || !result.text) {
                    throw new Error('Failed to generate breakdown');
                }

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

async function generateVozThreadSummary(threadUrl, fetchPage, onProgress, signal) {
    const allPosts = [];
    let currentUrl = threadUrl.replace(/\/page-\d+/i, '').replace(/\/unread\/?$/i, '');
    let pageNum = 0;
    let totalPages = null;
    let crawledPagesCount = 0;

    onProgress({ stage: 'crawling', current: 0, total: null, message: 'Starting thread crawl...', threadUrl });

    while (currentUrl) {
        if (signal?.aborted) throw new Error('Cancelled');
        
        // Extract page number from URL if possible, otherwise just increment
        const pageMatch = currentUrl.match(/page-(\d+)/i);
        if (pageMatch) {
            pageNum = parseInt(pageMatch[1]);
        } else if (pageNum === 0) {
            pageNum = 1;
        } else {
            pageNum++;
        }
        
        crawledPagesCount++;
        
        onProgress({
            stage: 'crawling',
            current: pageNum,
            total: totalPages,
            message: `Collecting page ${pageNum}${totalPages ? ` of ${totalPages}` : ''}...`,
            threadUrl
        });

        try {
            const pageData = await fetchPage(currentUrl);
            if (!pageData) break;

            const posts = extractVozPosts(pageData.content);
            allPosts.push(...posts);

            if (pageData.pagination) {
                totalPages = pageData.pagination.totalPages || totalPages;
                currentUrl = pageData.pagination.nextUrl || null;
            } else {
                currentUrl = null;
            }

            if (currentUrl) await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
            if (e.message === 'Cancelled') throw e;
            console.error(`[SUMMARY] VOZ page ${pageNum} error: ${e.message}`);
            break;
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
    const model = 'gemini-3.5-flash';

    onProgress({
        stage: 'generating',
        current: null,
        total: null,
        message: `Generating summary (${allPosts.length} posts)...`,
        threadUrl
    });

    const prompt = buildVozThreadPrompt(postsText, language, {
        title: threadUrl.split('/').pop()?.replace(/-/g, ' ') || ''
    });

    const result = await generateWithFallback(model, prompt, {
        maxTokens: 1200,
        timeoutMs: 180000
    });

    const parsed = parseSummaryResponse(result.text);

    return {
        status: 'ready',
        tldr: parsed.tldr,
        keyPoints: parsed.keyPoints,
        discussion: parsed.discussion || null,
        language,
        modelUsed: model,
        generatedAt: Date.now(),
        durationMs: Math.round((result.totalDuration || 0) / 1e6),
        totalPosts: allPosts.length,
        totalPages: pageNum,
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

export {
    summaryQueue,
    geminiKeyManager,
    qwenKeyManager,
    getSummaryFromCache,
    writeSummaryToCache,
    generateVozThreadSummary,
    detectLanguage,
    stripHtml as stripHtmlForSummary,
    generateDeepAnalysis
};

// Owns article / speech on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticleSpeech = {
    create() {
        return {
                articleSpeechState: 'idle',
                articleSpeechChunks: [],
                articleSpeechIndex: 0,
                articleSpeechGeneration: 0,
                nativeAudioEl: null,

                supportsArticleSpeech() {
                    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
                },

                stopArticleSpeech() {
                    this.articleSpeechGeneration += 1;
                    if (this.supportsArticleSpeech()) window.speechSynthesis.cancel();
                    this.articleSpeechState = 'idle';
                    this.articleSpeechChunks = [];
                    this.articleSpeechIndex = 0;
                },

                prepareArticleSpeech() {
                    if (!this.supportsArticleSpeech()) return;
                    
                    if (this.overlayHasNativeAudio) {
                        setTimeout(() => {
                            const audioEl = document.querySelector('#overlay-scroll-container audio');
                            if (audioEl) {
                                this.nativeAudioEl = audioEl;
                                this.articleSpeechState = audioEl.paused ? 'idle' : 'playing';
                                this.articleSpeechIndex = 0;
                                this.articleSpeechChunks = [1];
                                
                                const updateProgress = () => {
                                    if (audioEl.duration) {
                                        this.articleSpeechIndex = (audioEl.currentTime / audioEl.duration) * 100;
                                    }
                                };
                                audioEl.addEventListener('timeupdate', updateProgress);
                                audioEl.addEventListener('play', () => this.articleSpeechState = 'playing');
                                audioEl.addEventListener('pause', () => this.articleSpeechState = 'paused');
                                audioEl.addEventListener('ended', () => {
                                    this.articleSpeechState = 'idle';
                                    this.articleSpeechIndex = 0;
                                });
                            }
                        }, 100);
                        return;
                    }

                    const doc = new DOMParser().parseFromString(this.overlayContent || '', 'text/html');
                    doc.querySelectorAll('audio,video,figcaption').forEach(node => node.remove());
                    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!text) return;
                    const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
                    const chunks = [];
                    let current = '';
                    for (const sentence of sentences) {
                        const next = (current + ' ' + sentence.trim()).trim();
                        if (current && next.length > 260) {
                            chunks.push(current);
                            current = sentence.trim();
                        } else current = next;
                    }
                    if (current) chunks.push(current);
                    this.articleSpeechChunks = chunks;
                    this.articleSpeechIndex = 0;
                    this.articleSpeechState = 'idle';
                    this.nativeAudioEl = null;
                },

                toggleArticleSpeech() {
                    if (!this.supportsArticleSpeech()) return;
                    
                    if (this.nativeAudioEl) {
                        if (this.nativeAudioEl.paused) this.nativeAudioEl.play();
                        else this.nativeAudioEl.pause();
                        return;
                    }

                    if (this.articleSpeechState === 'playing') {
                        window.speechSynthesis.pause();
                        this.articleSpeechState = 'paused';
                        return;
                    }
                    if (this.articleSpeechState === 'paused') {
                        window.speechSynthesis.resume();
                        this.articleSpeechState = 'playing';
                        return;
                    }

                    if (!this.articleSpeechChunks.length) this.prepareArticleSpeech();
                    if (!this.articleSpeechChunks.length) return;
                    if (this.articleSpeechIndex >= this.articleSpeechChunks.length - 1) this.articleSpeechIndex = 0;
                    this.articleSpeechState = 'playing';
                    this.speakNextArticleChunk();
                },

                seekArticleSpeech(index) {
                    if (this.nativeAudioEl) {
                        if (this.nativeAudioEl.duration) {
                            this.nativeAudioEl.currentTime = (index / 100) * this.nativeAudioEl.duration;
                        }
                        return;
                    }
                    if (!this.articleSpeechChunks.length) return;
                    this.articleSpeechGeneration += 1;
                    window.speechSynthesis.cancel();
                    this.articleSpeechIndex = Math.max(0, Math.min(this.articleSpeechChunks.length - 1, Number(index) || 0));
                    this.articleSpeechState = 'playing';
                    setTimeout(() => this.speakNextArticleChunk(), 0);
                },

                skipArticleSpeech(direction) {
                    if (this.nativeAudioEl) {
                        this.nativeAudioEl.currentTime = Math.max(0, Math.min(this.nativeAudioEl.duration || Number.MAX_VALUE, this.nativeAudioEl.currentTime + (direction * 15)));
                        return;
                    }
                    this.seekArticleSpeech(this.articleSpeechIndex + (Number(direction) || 0));
                },

                articleSpeechProgressLabel() {
                    if (this.nativeAudioEl && this.nativeAudioEl.duration) {
                        const fmt = t => `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;
                        return `${fmt(this.nativeAudioEl.currentTime)} / ${fmt(this.nativeAudioEl.duration)}`;
                    }
                    if (!this.articleSpeechChunks.length) return '0 / 0';
                    return (this.articleSpeechIndex + 1) + ' / ' + this.articleSpeechChunks.length;
                },

                speakNextArticleChunk() {
                    if (!this.supportsArticleSpeech() || this.articleSpeechState === 'idle') return;
                    if (this.articleSpeechIndex >= this.articleSpeechChunks.length) {
                        this.articleSpeechState = 'idle';
                        this.articleSpeechIndex = Math.max(0, this.articleSpeechChunks.length - 1);
                        return;
                    }
                    const generation = this.articleSpeechGeneration;
                    const utterance = new SpeechSynthesisUtterance(this.articleSpeechChunks[this.articleSpeechIndex]);
                    let isVietnamese = false;
                    try { isVietnamese = new URL(this.overlayArticle?.link || '').hostname.endsWith('.vn'); } catch (e) { }
                    utterance.lang = isVietnamese ? 'vi-VN' : (navigator.language || 'en-US');
                    const languagePrefix = utterance.lang.split('-')[0].toLowerCase();
                    const voice = window.speechSynthesis.getVoices().find(candidate => String(candidate.lang || '').toLowerCase().startsWith(languagePrefix));
                    if (voice) utterance.voice = voice;
                    utterance.onend = () => {
                        if (generation !== this.articleSpeechGeneration || this.articleSpeechState === 'idle') return;
                        this.articleSpeechIndex += 1;
                        this.speakNextArticleChunk();
                    };
                    utterance.onerror = event => {
                        if (!['canceled', 'interrupted'].includes(event.error)) this.stopArticleSpeech();
                    };
                    window.speechSynthesis.speak(utterance);
                },
        };
    }
};

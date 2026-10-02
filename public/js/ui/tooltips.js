// Owns ui / tooltips on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderUiTooltips = {
    create() {
        return {

                // CUSTOM TOOLTIP STATE
                customTooltipOpen: false,
                tooltipTitle: '',
                tooltipContent: '',
                tooltipX: 0,
                tooltipY: 0,
                tooltipTriggerElement: null,
                tooltipShowTimer: null,
                tooltipHideTimer: null,
                tooltipDismissController: null,
                clearTooltipTimers() {
                    if (this.tooltipShowTimer) clearTimeout(this.tooltipShowTimer);
                    if (this.tooltipHideTimer) clearTimeout(this.tooltipHideTimer);
                    this.tooltipShowTimer = null;
                    this.tooltipHideTimer = null;
                },
                positionTooltip(e) {
                    let x = e.clientX + 15;
                    let y = e.clientY + 15;
                    const maxW = Math.min(350, window.innerWidth - 32);
                    if (x + maxW > window.innerWidth) x = window.innerWidth - maxW - 16;
                    if (x < 16) x = 16;

                    this.tooltipX = x;
                    this.tooltipY = y;
                },
                showTooltip(e, title, content) {
                    const pointerType = String(e?.pointerType || '').toLowerCase();
                    if (this.articleOverlayOpen || pointerType === 'touch' || (!pointerType && this.isTouch)) {
                        this.hideTooltip();
                        return;
                    }
                    this.clearTooltipTimers();
                    this.tooltipTriggerElement = e.currentTarget || null;
                    this.tooltipTitle = title;
                    this.tooltipContent = content;
                    this.positionTooltip(e);
                    this.customTooltipOpen = true;
                },
                moveTooltip(e) {
                    if (!this.customTooltipOpen || String(e?.pointerType || '').toLowerCase() === 'touch') return;
                    if (this.tooltipTriggerElement && e.currentTarget !== this.tooltipTriggerElement) return;
                    this.positionTooltip(e);
                },
                hideTooltip() {
                    this.clearTooltipTimers();
                    this.customTooltipOpen = false;
                    this.tooltipTriggerElement = null;
                },
                installTooltipDismissListeners() {
                    if (this.tooltipDismissController) this.tooltipDismissController.abort();
                    if (typeof AbortController === 'undefined') return;

                    const controller = new AbortController();
                    const signal = controller.signal;
                    const dismiss = () => this.hideTooltip();
                    this.tooltipDismissController = controller;

                    window.addEventListener('blur', dismiss, { signal });
                    window.addEventListener('resize', dismiss, { passive: true, signal });
                    window.addEventListener('scroll', dismiss, { capture: true, passive: true, signal });
                    window.addEventListener('hashchange', dismiss, { signal });
                    window.addEventListener('popstate', dismiss, { signal });
                    document.addEventListener('visibilitychange', () => {
                        if (document.hidden) dismiss();
                    }, { signal });
                    document.addEventListener('pointerdown', (event) => {
                        if (!this.customTooltipOpen) return;
                        const trigger = this.tooltipTriggerElement;
                        if (!trigger || !trigger.contains(event.target)) dismiss();
                    }, { capture: true, signal });
                    document.addEventListener('focusin', (event) => {
                        if (!this.customTooltipOpen) return;
                        const trigger = this.tooltipTriggerElement;
                        if (!trigger || !trigger.contains(event.target)) dismiss();
                    }, { capture: true, signal });
                },
        };
    }
};

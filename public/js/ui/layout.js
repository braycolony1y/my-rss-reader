// Owns ui / layout on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderUiLayout = {
    create() {
        return {
                theme: localStorage.getItem('theme') || 'classic',
                
                isMobile: window.innerWidth < 768,
                isTouch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
                mobileSidebarOpen: false,
                sidebarExpanded: false,
                desktopSidebarOpen: false, 
                mobileActiveCard: null,

                toggleSidebar() {
                    this.hideTooltip();
                    if (this.isMobile) {
                        this.mobileSidebarOpen = !this.mobileSidebarOpen;
                    } else {
                        this.sidebarExpanded = !this.sidebarExpanded;
                    }
                },

                closeSidebar() {
                    this.hideTooltip();
                    this.mobileSidebarOpen = false;
                    this.sidebarExpanded = false;
                },

                cycleTheme() {
                    this.theme = this.theme === 'glass' ? 'glass-light' : (this.theme === 'glass-light' ? 'classic' : 'glass');
                    localStorage.setItem('theme', this.theme);
                    this.syncUserPreferenceDebounced('theme', this.theme);
                },
        };
    }
};

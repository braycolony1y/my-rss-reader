// Page transitions have one owner. Failed/expired responses cannot advance the cursor.
const ReaderFeedPagination = {
    async loadMore() {
        if (!this.hasMore || this.isLoadingMore || this.isLoadingArticles) return;
        const previousPage = this.currentPage, generation = this.articleRequestGeneration + 1;
        this.isLoadingMore = true;
        this.currentPage = previousPage + 1;
        try {
            const result = await this.fetchData(true);
            if (!result?.ok) {
                if (this.articleRequestGeneration === generation && this.currentPage === previousPage + 1) this.currentPage = previousPage;
                this._autoLoadPaused = true;
            } else this._autoLoadPaused = result.added === 0;
        } finally {
            this.isLoadingMore = false;
            if (typeof this.saveState === 'function') this.saveState();
        }
    },
    async goToPage(page) {
        if (page < 1 || this.isLoadingMore || this.isLoadingArticles) return;
        if (!this.hasMore && page > this.currentPage) return;
        const previousPage = this.currentPage, previousArticles = this.articles, generation = this.articleRequestGeneration + 1;
        this.isLoadingMore = true;
        this.currentPage = page;
        try {
            // fetchData owns the visible list; do not allow a refresh to interrupt it.
            const result = await this.fetchData(false, true);
            if (result?.ok) {
                this._autoLoadPaused = false;
                await this.$nextTick();
                document.getElementById('scroll-container')?.scrollTo(0, 0);
            } else if (this.articleRequestGeneration === generation && this.currentPage === page) {
                this.currentPage = previousPage;
                this.articles = previousArticles;
            }
        } finally {
            this.isLoadingMore = false;
            if (typeof this.saveState === 'function') this.saveState();
        }
    },
    handleScroll(event) {
        const container = event.target;
        const context = JSON.stringify([this.selectedFilterType, this.selectedFilterValue, this.smartTabMode, this.hideRead, this.searchQuery]);
        if (this._autoLoadContext !== context) {
            this._autoLoadContext = context;
            this._autoLoadPaused = false;
            this._lastFeedScrollTop = 0;
        }
        const previousTop = this._lastFeedScrollTop || 0;
        this._lastFeedScrollTop = container.scrollTop;
        if (this.isMobile || this.isLoadingArticles || this.isLoadingMore || !this.hasMore || this._autoLoadPaused) return;
        // Resizes and paint/anchoring events at the same position are not new scrolling.
        if (container.scrollTop <= previousTop) return;
        if (container.scrollHeight - container.scrollTop <= container.clientHeight + 300) this.loadMore();
    }
};

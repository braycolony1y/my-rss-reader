// Scoped classic-script module. Served before the legacy reader factory.
(() => {
    function createState() {
        return {
            storyAnalysisOpen: {},
            storyPanelExpanded: {},
            resetStoryPanels() {
                this.storyAnalysisOpen = {};
                this.storyPanelExpanded = {};
            },
            storyPanelIsExpanded(article) {
                return this.storyPanelExpanded[article.clusterId || article.link] !== false;
            },
            toggleStoryPanel(article) {
                const id = article.clusterId || article.link;
                this.storyPanelExpanded = { ...this.storyPanelExpanded, [id]: !this.storyPanelIsExpanded(article) };
            },
            toggleStoryAnalysis(article, label) {
                const id = article.clusterId || article.link;
                // Tabs always keep one section selected and reopen its panel.
                this.storyAnalysisOpen = { ...this.storyAnalysisOpen, [id]: label };
                this.storyPanelExpanded = { ...this.storyPanelExpanded, [id]: true };
            }
        };
    }
    globalThis.ArticlePanels = Object.freeze({ createState });
})();

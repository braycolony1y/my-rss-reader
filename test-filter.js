const readStates = ['http://main.com'];
let filteredArticles = [
    {
        link: 'http://main.com',
        relatedArticles: [
            { link: 'http://related1.com' }
        ]
    }
];

const hideRead = true;
if (hideRead) {
    filteredArticles = filteredArticles.filter(article => !readStates.includes(article.link)).map(article => {
        if (!article.relatedArticles || !article.relatedArticles.length) return article;
        const unreadRelated = article.relatedArticles.filter(r => !readStates.includes(r.link));
        if (unreadRelated.length === article.relatedArticles.length) return article;
        return {
            ...article,
            relatedArticles: unreadRelated,
        };
    });
}
console.log(JSON.stringify(filteredArticles, null, 2));

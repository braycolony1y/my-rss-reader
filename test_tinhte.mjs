import { fetchArticleContent } from './server.js';
fetchArticleContent('https://tinhte.vn/thread/thang-con-nho-mua-dia-cd-nhac-nhat-o-tokyo.4151455/', 'dummy').then(res => {
    console.log(res.content ? res.content : 'NO CONTENT');
    process.exit(0);
}).catch(console.error);

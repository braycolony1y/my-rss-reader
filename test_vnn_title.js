const inner = `<article class="ck-cms-insert-news" data-vnnembed="true" data-vnnembedtype="article" data-vnnembedid="2399385"><a href="/cu-quay-xe-cua-dieu-tra-vien-trong-vu-nu-sinh-o-vinh-long-bi-tong-tu-vong-2399385.html" title="Cú 'quay xe' của điều tra viên trong vụ nữ sinh ở Vĩnh Long bị tông tử vong"><picture><img src="..." alt="Cú 'quay xe' của điều tra viên trong vụ nữ sinh ở Vĩnh Long bị tông tử vong"></picture></a>
<div class="insert-wiki-title"><a href="/cu-quay-xe-cua-dieu-tra-vien-trong-vu-nu-sinh-o-vinh-long-bi-tong-tu-vong-2399385.html" title="Cú 'quay xe' của điều tra viên trong vụ nữ sinh ở Vĩnh Long bị tông tử vong">Cú 'quay xe' của điều tra viên trong vụ nữ sinh ở Vĩnh Long bị tông tử vong</a></div></article>`;

const linkMatch = inner.match(/<div\b[^>]*class=["'][^"']*insert-wiki-title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=(["'])([\s\S]*?)\2/i) || inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);

let relUrl = linkMatch[1];
let relTitle = (linkMatch[3] !== undefined && (linkMatch[2] === '"' || linkMatch[2] === "'")) ? linkMatch[3] : linkMatch[2];

console.log("url:", relUrl);
console.log("title:", relTitle);

const inner2 = `<a href="/test.html" title='Test "title"'></a>`;
const linkMatch2 = inner2.match(/<div\b[^>]*class=["'][^"']*insert-wiki-title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || inner2.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=(["'])([\s\S]*?)\2/i) || inner2.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
let relUrl2 = linkMatch2[1];
let relTitle2 = (linkMatch2[3] !== undefined && (linkMatch2[2] === '"' || linkMatch2[2] === "'")) ? linkMatch2[3] : linkMatch2[2];
console.log("url2:", relUrl2);
console.log("title2:", relTitle2);

const inner3 = `<a href="/test3.html">Simple title</a>`;
const linkMatch3 = inner3.match(/<div\b[^>]*class=["'][^"']*insert-wiki-title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || inner3.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=(["'])([\s\S]*?)\2/i) || inner3.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
let relUrl3 = linkMatch3[1];
let relTitle3 = (linkMatch3[3] !== undefined && (linkMatch3[2] === '"' || linkMatch3[2] === "'")) ? linkMatch3[3] : linkMatch3[2];
console.log("url3:", relUrl3);
console.log("title3:", relTitle3);

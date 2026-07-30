async function test() {
    const url = "https://rss-proxy.k1d.workers.dev/?url=" + encodeURIComponent("https://voz.vn/t/cac-loi-khuyen-cua-cac-hr-va-sep-cu-da-nhau-the-nao-y-domain-vs-da-nang.1265202/unread");
    const res = await fetch(url);
    console.log(res.status);
    const text = await res.text();
    console.log("HTML START:", text.slice(0, 500));
}
test();

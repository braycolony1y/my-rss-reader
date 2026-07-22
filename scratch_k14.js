const url = 'https://kenh14.vn/hieuthuhai-bat-can-canh-messi-that-than-sau-tran-thua-my-tam-chi-noi-1-cau-ve-huyen-thoai-argentina-215260720061304408.chn';
fetch(url).then(r => r.text()).then(html => {
    const match = html.match(/<div\b[^>]*class=["'][^"']*knc-relate-wrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if(match) console.log(match[1]);
    else console.log('not found');
});

const https = require('https');
https.get('https://www.vietnamplus.vn/benh-vien-bach-mai-co-so-ninh-binh-bao-dong-do-cuu-8-nan-nhan-ngo-doc-khi-post1125344.vnp', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        const fs = require('fs');
        fs.writeFileSync('scratch_vietnamplus.html', data);
        console.log('done', data.length);
    });
});

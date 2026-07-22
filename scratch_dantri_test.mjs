const res = await fetch('http://localhost:3000/api/article?url=https://dantri.com.vn/thoi-tiet/mien-bac-giam-mua-nhieu-noi-nang-nong-20260720215519144.htm', {
    headers: { 'Cookie': 'connect.sid=some-cookie' } // It might need auth, wait I will just test DantriSource.js
});
console.log(res.status);

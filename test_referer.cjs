const fs = require('fs');
fetch('https://cdnphoto.dantri.com.vn/547RCEnuNEYbPs7ukdx59LYSjPU=/thumb_w/1020/2026/07/21/ta-hienhk01-1784648220888.png', {
    headers: { 'Referer': 'https://google.com' }
}).then(res => console.log('STATUS:', res.status)).catch(err => console.log('ERROR:', err.message));

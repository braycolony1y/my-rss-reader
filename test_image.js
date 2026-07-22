const fs = require('fs');
const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .voz-post-body .bbImageWrapper {
            display: inline-block !important;
            max-width: 100% !important;
            vertical-align: middle !important;
        }
        .voz-post-body .bbImageWrapper img {
            max-width: 100% !important;
            height: auto !important;
        }
    </style>
</head>
<body>
    <div class="voz-post-body" style="width: 500px; border: 1px solid red; padding: 10px;">
        TÔI YÊU TẬP ĐOÀN V, MONG V MÃI TRƯỜNG TỒN VÀ VIỆT NAM CÓ THÊM 100 V 
        <div id="img1" class="bbImageWrapper lazyload js-lbImage">
            <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:60px;height:60px;" class="bbImage lazyload">
        </div>
        <div id="img2" class="bbImageWrapper lazyload js-lbImage">
            <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:60px;height:60px;" class="bbImage lazyload">
        </div>
    </div>
</body>
</html>`;
fs.writeFileSync('test_puppeteer.html', html);

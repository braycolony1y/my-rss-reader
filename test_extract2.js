const { isInvalidImage } = require('./server.js');
console.log("Is 1200_630 invalid?", isInvalidImage("https://cdn2.tuoitre.vn/zoom/1200_630/471584752817336320/2026/7/21/anh.png"));
console.log("Is 100_100 invalid?", isInvalidImage("https://cdn2.tuoitre.vn/zoom/100_100/471584752817336320/2026/7/21/anh.png"));

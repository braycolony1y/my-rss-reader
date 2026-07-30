const { JSDOM } = require("jsdom");
const dom = new JSDOM(`
    <style>
        .test {
            background-color: rgb(17, 24, 39);
        }
        .test.override {
            background: linear-gradient(145deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.4) 100%) !important;
        }
    </style>
    <div class="test override" id="el"></div>
`);
const style = dom.window.getComputedStyle(dom.window.document.getElementById('el'));
console.log(style.getPropertyValue('background-color'));

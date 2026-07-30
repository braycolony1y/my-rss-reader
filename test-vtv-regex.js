const img = `<img fetchpriority="high" decoding="async" src="https://cdn-images.vtv.vn/thumb_w/1200/66349b6076cb4dee98746cf1/2026/07/22/tay-ban-nha-vo--ich-2-46615863901866875512858-07944304105991048851709.jpg" alt="Ảnh: AP" title="Ảnh: AP" data-role='avatar'/>`;
const match = /(class|src)=["'][^"']*(avatar|author|logo|smilie|emoji)[^"']*["']/i.test(img);
console.log("Match:", match);

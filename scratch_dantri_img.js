const html = `<img title="Vụ tai nạn ở trang trại lợn Thanh Hóa: 8 bệnh nhân cấp cứu tại BV Bạch Mai - 1" src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox%3D'0 0 1920 1280'%3E%3Crect x='0' y='0' width='100%' height='100%' style='fill:rgb(241, 245, 249)' %2F%3E%3C%2Fsvg%3E" alt="Vụ tai nạn ở trang trại lợn Thanh Hóa: 8 bệnh nhân cấp cứu tại BV Bạch Mai - 1" data-width="1920" data-height="1280" data-original="https://cdnphoto.dantri.com.vn/k-19qNENWePnabXqNI90pWqGgqQ=/2026/07/20/trang-trai-lon-cropped-1784503499823.jpg">`;

let result = html.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
    const dataSrcMatch = attrs.match(/data-src=["']([^"']+)["']/i);
    const dataOriginalMatch = attrs.match(/data-original=["']([^"']+)["']/i);
    const realSrc = (dataSrcMatch && dataSrcMatch[1]) || (dataOriginalMatch && dataOriginalMatch[1]);
    if (realSrc) {
        let cleanedAttrs = attrs.replace(/\bsrc=(?:"[^"]*"|'[^']*')/i, '');
        return `<img src="${realSrc}" ${cleanedAttrs}>`;
    }
    return match;
});

console.log(result);

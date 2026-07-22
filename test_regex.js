const html = `<div class="VCSortableInPreviewMode alignCenter" data-back="#FFFBF2" data-border="#F2D1AA" data-text-color="#333333" style="background-color:#FFFBF2;border-color:#F2D1AA;display:block;color:#333333;" id="ObjectBoxContent_1784645693367" type="content">
    <div placeholder="Nhập nội dung...">
        <h2>Cú tông mạnh ngay vị trí lên xuống</h2>
        <p>Như <i>Tuổi Trẻ</i> đưa tin...</p>
        <p>Another paragraph.</p>
    </div>
</div>`;

const res = html.replace(/<div\b[^>]*type=["']content["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, (m, inner) => {
    let content = inner + '</div>';
    content = content.replace(/<h2/i, '<h2 class="text-xl font-bold mb-3 text-amber-900 dark:text-amber-500"');
    content = content.replace(/<p>/gi, '<p class="mb-2">');
    return `<div class="not-prose my-6 p-5 rounded-2xl bg-amber-50 dark:bg-amber-900/10 border-l-4 border-l-amber-400 dark:border-l-amber-600 text-gray-800 dark:text-gray-200 shadow-sm leading-relaxed">${content}</div>`;
});
console.log(res);

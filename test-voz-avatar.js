import fetch from 'node-fetch';
async function run() {
    const res = await fetch('https://voz.vn/t/bong-dung-thanh-chu-doanh-nghiep-no-thue-bi-tam-hoan-xuat-canh.994788/');
    const text = await res.text();
    const avatarMatch = text.match(/class=["'][^"']*avatar\b[^>]*>[\s\S]*?src=["']([^"']+)["']/i);
    const dynamicAvatarMatch = text.match(/avatar--default--dynamic[^>]*style=["']background-color:\s*#([a-f0-9]+);\s*color:\s*#([a-f0-9]+)["']/i);
    console.log("Avatar Match:", avatarMatch ? avatarMatch[1] : null);
    console.log("Dynamic Match:", dynamicAvatarMatch ? [dynamicAvatarMatch[1], dynamicAvatarMatch[2]] : null);
}
run();

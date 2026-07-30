const htmlWithAvatar = `<a href="/u/username.123/" class="avatar avatar--m" data-user-id="123" data-xf-init="member-tooltip">
    <img src="/data/avatars/m/12/12345.jpg?12345" alt="username" class="avatar-crop-img">
</a>
<div class="message-content"> <img src="smiley.png"> </div>`;

const htmlWithoutAvatar = `<span class="avatar avatar--m avatar--default avatar--default--dynamic" data-user-id="123" style="background-color: #123; color: #fff;">
    <span class="avatar-u123-m" dir="auto">T</span>
</span>
<div class="message-content"> <img src="smiley.png"> </div>`;

function getAvatar(artHtml) {
    const avatarImgMatch = artHtml.match(/class=["'][^"']*avatar\b[^>]*>(?:(?!\/a>|<\/span>)[\s\S])*?<img\b[^>]*src=["']([^"']+)["']/i);
    const dynamicAvatarMatch = artHtml.match(/avatar--default--dynamic[^\>]*style=["']background-color:\s*#([a-f0-9]+);\s*color:\s*#([a-f0-9]+)["']/i);
    
    if (avatarImgMatch) return avatarImgMatch[1];
    if (dynamicAvatarMatch) return `dynamic: ${dynamicAvatarMatch[1]}`;
    return 'none';
}

console.log("With:", getAvatar(htmlWithAvatar));
console.log("Without:", getAvatar(htmlWithoutAvatar));

const html = `<span class="avatar avatar--m avatar--default avatar--default--dynamic" data-user-id="123" style="background-color: #123; color: #fff;">`;
const match = html.match(/avatar--default--dynamic[^>]*style=["']background-color:\s*#([a-f0-9]+);\s*color:\s*#([a-f0-9]+)["']/i);
console.log(match);

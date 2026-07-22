const fs = require('fs');
const html = fs.readFileSync('tinhte.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
if (match) {
    const data = JSON.parse(match[1]);
    const jobs = data.props.initialState.appForo.jobs;
    for (const key in jobs) {
        if (jobs[key] && jobs[key].thread && jobs[key].posts) {
            const posts = jobs[key].posts;
            if (posts.length > 0) {
                console.log("POST BODY HTML:\n", posts[0].post_body_html);
                break;
            }
        }
    }
}

fetch("http://localhost:3000/api/article-content?url=https%3A%2F%2Fvoz.vn%2Ft%2Ftien-trong-dan-rat-nhieu.1261189%2Fpost-42970590", {
  headers: { "Cookie": "auth=1" } // not needed if auth is disabled, but just in case
})
.then(r => r.json())
.then(d => {
  const fs = require('fs');
  fs.writeFileSync('test-api-out.html', d.html || JSON.stringify(d));
  console.log(d.html ? "HTML length: " + d.html.length : "Failed to fetch HTML");
})
.catch(e => console.log(e));

const fs = require("fs");
try {
    const data = JSON.parse(fs.readFileSync("database.json"));
    let articles = JSON.parse(data.articles);
    let count = 0;
    for (let a of articles) {
        if (a.content) {
            a.content = "";
            a.articleBody = "";
            count++;
        }
    }
    data.articles = JSON.stringify(articles);
    fs.writeFileSync("database.json", JSON.stringify(data));
    console.log("Cleared " + count + " articles");
} catch(e) { console.error(e); }


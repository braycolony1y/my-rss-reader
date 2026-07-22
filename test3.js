import fs from 'fs';
import { execSync } from 'child_process';

const url = "https://vietnamnet.vn/danh-tinh-tai-xe-o-to-7-cho-khong-nhuong-duong-cho-xe-cuu-thuong-suot-5km-2536738.html";

// Read auth token if any
let authHeader = '';
try {
    const env = fs.readFileSync('.env', 'utf-8');
    const match = env.match(/AUTH_PASSWORD=([^\n\r]+)/);
    if (match) {
        authHeader = match[1];
    }
} catch(e) {}

const cmd = `curl -s -H "Cookie: auth=true" "http://localhost:3000/api/article-content?url=${encodeURIComponent(url)}" > debug.json`;
execSync(cmd);
const output = fs.readFileSync('debug.json', 'utf-8');
try {
    const json = JSON.parse(output);
    console.log("Success! Contains BÀI VIẾT LIÊN QUAN:", (json.content || "").includes("BÀI VIẾT LIÊN QUAN"));
    console.log("Content length:", (json.content || "").length);
    if (json.error) console.log("Error:", json.error);
} catch(e) {
    console.log("Not JSON:", output.substring(0, 100));
}

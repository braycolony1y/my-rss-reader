import json
import re

with open('tinhte.html', 'r', encoding='utf-8') as f:
    html = f.read()

match = re.search(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>', html)
if match:
    data = json.loads(match.group(1))
    
    def find_post(d):
        if isinstance(d, dict):
            if 'post_body_html' in d and 'attachments' in d:
                return d
            for k, v in d.items():
                res = find_post(v)
                if res: return res
        elif isinstance(d, list):
            for i in d:
                res = find_post(i)
                if res: return res
        return None
        
    post = find_post(data)
    if post:
        print(json.dumps(post.get('attachments', []), indent=2))
    else:
        print("No post found")

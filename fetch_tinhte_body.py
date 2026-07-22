import json
import re
import urllib.request

req = urllib.request.Request('https://rss-proxy.k1d.workers.dev/?url=https://tinhte.vn/thread/mo-bung-thinkpad-x1-carbon-gen-14-aura-edition-gia-104-trieu-coi-thiet-ke-moi.4155397/', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>', html)
        if match:
            data = json.loads(match.group(1))
            
            def find_post(d):
                if isinstance(d, dict):
                    if 'post_body_html' in d:
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
                with open('tinhte_body2.html', 'w', encoding='utf-8') as f:
                    f.write(post['post_body_html'])
                print("Extracted post_body_html to tinhte_body2.html")
            else:
                print("No post found")
except Exception as e:
    print(e)

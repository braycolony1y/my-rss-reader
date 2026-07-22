import json
import re

with open('raw_thread.html', 'r', encoding='utf-8') as f:
    html = f.read()

match = re.search(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>', html)
if match:
    data = json.loads(match.group(1))
    
    def search_dict(d, path):
        if isinstance(d, dict):
            for k, v in d.items():
                if isinstance(v, str) and 'Quảng cáo' in v:
                    print(f"Found in {path}.{k}")
                search_dict(v, f"{path}.{k}")
        elif isinstance(d, list):
            for i, v in enumerate(d):
                if isinstance(v, str) and 'Quảng cáo' in v:
                    print(f"Found in {path}[{i}]")
                search_dict(v, f"{path}[{i}]")
                
    search_dict(data, "root")

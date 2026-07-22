import re, urllib.request

with open("vnexpress_desktop.html", "r") as f:
    html = f.read()

js_urls = re.findall(r"<script[^>]*src=[\"']([^\"']+)[\"']", html)
for js in js_urls:
    if js.startswith("//"): js = "https:" + js
    try:
        content = urllib.request.urlopen(js).read().decode("utf-8")
        if "tin_xemthem" in content or "data-component-type" in content:
            print("Found in", js)
            matches = re.findall(r".{0,100}data-component-type.{0,100}", content)
            print(matches[0] if matches else "")
            matches_api = re.findall(r"[\"'][^\"']*?/[a-zA-Z0-9_-]+\?.*?[\"']", content)
            for m in matches_api:
                if "type" in m or "id" in m:
                    print("Possible API:", m)
    except Exception as e:
        pass

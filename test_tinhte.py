import urllib.request
import json
req = urllib.request.Request('http://localhost:8191/v1', data=json.dumps({"cmd":"request.get","url":"https://tinhte.vn/thread/xua-thich-ipad-m1-op-ban-phim-apple-bo-balo-no-nang-hon-ca-con-macbook-16inch-rang-khong-noi.4161478/","maxTimeout":60000}).encode('utf-8'), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req) as response:
    res = json.loads(response.read().decode('utf-8'))
    html = res.get('solution', {}).get('response', '')
    with open('tinhte.html', 'w') as f:
        f.write(html)

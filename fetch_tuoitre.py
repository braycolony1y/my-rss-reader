import urllib.request
import re

req = urllib.request.Request('https://rss-proxy.k1d.workers.dev/?url=https://tuoitre.vn/hinh-anh-ban-lang-o-lai-chau-bi-lu-quet-tan-pha-100260718001050094.htm', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        with open('tuoitre_test.html', 'w', encoding='utf-8') as f:
            f.write(html)
        print("Fetched to tuoitre_test.html")
except Exception as e:
    print(e)

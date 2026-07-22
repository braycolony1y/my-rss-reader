import urllib.request

req = urllib.request.Request('https://rss-proxy.k1d.workers.dev/?url=https://vnexpress.net/my-khong-kich-dem-thu-7-lien-tiep-iran-doa-tan-cong-tong-luc-5098778.html', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        with open('vnexpress_test.html', 'w', encoding='utf-8') as f:
            f.write(html)
        print("Fetched to vnexpress_test.html")
except Exception as e:
    print(e)

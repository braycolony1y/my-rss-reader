import re
with open('tinhte_body2.html', 'r', encoding='utf-8') as f:
    html = f.read()

matches = re.finditer(r'.{0,50}Quảng cáo.{0,50}', html, flags=re.IGNORECASE)
found = False
for m in matches:
    print(m.group(0))
    found = True
if not found:
    print("Not found in body HTML.")

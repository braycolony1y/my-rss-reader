import csv

def find_fvgs():
    bull_fvgs = []
    
    with open('/Users/eidetiker/Downloads/CME_MINI_ES1!, 1_dd255.csv', 'r') as f:
        reader = csv.DictReader(f)
        data = []
        for row in reader:
            data.append({
                'time': int(row['time']),
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close'])
            })
            
    for i in range(2, len(data)):
        high2 = data[i-2]['high']
        low0 = data[i]['low']
        open1 = data[i-1]['open']
        close1 = data[i-1]['close']
        
        is_bull = (low0 > high2) and (close1 > open1)
        if is_bull:
            bull_fvgs.append({
                'time': data[i]['time'],
                'top': low0,
                'bottom': high2,
                'index': i
            })

    overlapping = 0
    for i in range(1, len(bull_fvgs)):
        curr = bull_fvgs[i]
        prev = bull_fvgs[i-1]
        
        # Check if they are close in time (e.g. consecutive or within 5 bars)
        if curr['index'] - prev['index'] <= 5:
            # Check overlap: gap is between bottom and top.
            # Two intervals [bottom1, top1] and [bottom2, top2] overlap if:
            # max(bottom1, bottom2) < min(top1, top2)
            if max(prev['bottom'], curr['bottom']) < min(prev['top'], curr['top']):
                overlapping += 1

    print(f"Total Bull FVGs: {len(bull_fvgs)}")
    print(f"Overlapping with recent: {overlapping}")

if __name__ == "__main__":
    find_fvgs()

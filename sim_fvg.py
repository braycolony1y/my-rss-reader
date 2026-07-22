import csv

def find_fvgs():
    bull_fvgs = []
    bear_fvgs = []
    
    with open('/Users/eidetiker/Downloads/CME_MINI_ES1!, 1_dd255.csv', 'r') as f:
        reader = csv.DictReader(f)
        # convert to list of dicts with float values
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
        low2 = data[i-2]['low']
        
        open1 = data[i-1]['open']
        close1 = data[i-1]['close']
        
        high0 = data[i]['high']
        low0 = data[i]['low']
        
        is_bull = (low0 > high2) and (close1 > open1)
        is_bear = (high0 < low2) and (close1 < open1)
        
        if is_bull:
            bull_fvgs.append({
                'time': data[i]['time'],
                'top': low0,
                'bottom': high2,
                'index': i,
                'mitigated_at': None
            })
        if is_bear:
            bear_fvgs.append({
                'time': data[i]['time'],
                'top': low2,
                'bottom': high0,
                'index': i,
                'mitigated_at': None
            })

    active_bull_fvgs = list(bull_fvgs)
    for i in range(2, len(data)):
        low0 = data[i]['low']
        time0 = data[i]['time']
        for fvg in active_bull_fvgs:
            if fvg['mitigated_at'] is None and i > fvg['index']:
                if low0 <= fvg['top']:
                    fvg['mitigated_at'] = time0
                    fvg['mitigated_index'] = i

    print(f"Total Bull FVGs: {len(bull_fvgs)}")
    print(f"Mitigated Bull FVGs: {len([f for f in bull_fvgs if f['mitigated_at'] is not None])}")
    print(f"Unmitigated Bull FVGs: {len([f for f in bull_fvgs if f['mitigated_at'] is None])}")

    print("\nFirst 5 unmitigated Bull FVGs:")
    for fvg in [f for f in bull_fvgs if f['mitigated_at'] is None][:5]:
        print(f"Time: {fvg['time']}, Top: {fvg['top']}, Bottom: {fvg['bottom']}")

if __name__ == "__main__":
    find_fvgs()

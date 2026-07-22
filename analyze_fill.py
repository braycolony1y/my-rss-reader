import csv

def analyze_logic():
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
            
    # Track with user's original logic
    # "Wick" fill = touches near boundary
    user_filled_count = 0
    fixed_filled_count = 0
    
    for i in range(2, len(data)-10):
        high2 = data[i-2]['high']
        low2 = data[i-2]['low']
        open1 = data[i-1]['open']
        close1 = data[i-1]['close']
        high0 = data[i]['high']
        low0 = data[i]['low']
        
        is_bull = (low0 > high2) and (close1 > open1)
        
        if is_bull:
            fvg_top = low0
            fvg_bottom = high2
            
            user_filled = False
            fixed_filled = False
            
            for j in range(i+1, len(data)):
                j_low = data[j]['low']
                
                if not user_filled and j_low <= fvg_top:
                    user_filled = True
                    user_filled_count += 1
                    
                if not fixed_filled and j_low <= fvg_bottom:
                    fixed_filled = True
                    fixed_filled_count += 1
                    
                if user_filled and fixed_filled:
                    break

    print(f"Original Logic (touches near boundary) fills: {user_filled_count}")
    print(f"Fixed Logic (touches far boundary) fills: {fixed_filled_count}")

if __name__ == "__main__":
    analyze_logic()

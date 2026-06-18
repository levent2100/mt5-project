import os

bridge_files = [f"scripts/mt5_http_bridge{i}.py" for i in range(1, 12)]

old_block_1 = """                tr = talib.TRANGE(high, low, close)
                
                atr_vals_2 = talib.SMA(tr, timeperiod=2)
                atr_2 = float(atr_vals_2[-1]) if atr_vals_2 is not None and len(atr_vals_2) > 0 and not np.isnan(atr_vals_2[-1]) else 0.0
                
                atr_vals_3 = talib.SMA(tr, timeperiod=3)
                atr_3 = float(atr_vals_3[-1]) if atr_vals_3 is not None and len(atr_vals_3) > 0 and not np.isnan(atr_vals_3[-1]) else 0.0
                
                atr_vals_5 = talib.SMA(tr, timeperiod=5)
                atr_5 = float(atr_vals_5[-1]) if atr_vals_5 is not None and len(atr_vals_5) > 0 and not np.isnan(atr_vals_5[-1]) else 0.0
                
                atr_vals_14 = talib.SMA(tr, timeperiod=14)
                atr_14 = float(atr_vals_14[-1]) if atr_vals_14 is not None and len(atr_vals_14) > 0 and not np.isnan(atr_vals_14[-1]) else 0.0
                
                long_period = 14400
                if len(rates) < long_period + 1:
                    long_period = len(rates) - 1
                
                if long_period >= 2:
                    atr_vals_14400 = talib.SMA(tr, timeperiod=long_period)
                    atr_14400 = float(atr_vals_14400[-1]) if atr_vals_14400 is not None and len(atr_vals_14400) > 0 and not np.isnan(atr_vals_14400[-1]) else 0.0
                else:
                    atr_14400 = 0.0"""

new_block_1 = """                # Calculate using Wilder's ATR (talib.ATR)
                atr_vals_2 = talib.ATR(high, low, close, timeperiod=2)
                atr_2 = float(atr_vals_2[-2]) if atr_vals_2 is not None and len(atr_vals_2) > 1 and not np.isnan(atr_vals_2[-2]) else 0.0
                
                atr_vals_3 = talib.ATR(high, low, close, timeperiod=3)
                atr_3 = float(atr_vals_3[-2]) if atr_vals_3 is not None and len(atr_vals_3) > 1 and not np.isnan(atr_vals_3[-2]) else 0.0
                
                atr_vals_5 = talib.ATR(high, low, close, timeperiod=5)
                atr_5 = float(atr_vals_5[-2]) if atr_vals_5 is not None and len(atr_vals_5) > 1 and not np.isnan(atr_vals_5[-2]) else 0.0
                
                atr_vals_14 = talib.ATR(high, low, close, timeperiod=14)
                atr_14 = float(atr_vals_14[-2]) if atr_vals_14 is not None and len(atr_vals_14) > 1 and not np.isnan(atr_vals_14[-2]) else 0.0
                
                long_period = 14400
                if len(rates) < long_period + 2:
                    long_period = len(rates) - 2
                
                if long_period >= 2:
                    atr_vals_14400 = talib.ATR(high, low, close, timeperiod=long_period)
                    atr_14400 = float(atr_vals_14400[-2]) if atr_vals_14400 is not None and len(atr_vals_14400) > 1 and not np.isnan(atr_vals_14400[-2]) else 0.0
                else:
                    atr_14400 = 0.0"""

old_block_2 = """    tr = talib.TRANGE(high, low, close)
    
    atr_vals_2 = talib.SMA(tr, timeperiod=2)
    atr_2 = float(atr_vals_2[-1]) if atr_vals_2 is not None and len(atr_vals_2) > 0 and not np.isnan(atr_vals_2[-1]) else 0.0
    
    atr_vals_3 = talib.SMA(tr, timeperiod=3)
    atr_3 = float(atr_vals_3[-1]) if atr_vals_3 is not None and len(atr_vals_3) > 0 and not np.isnan(atr_vals_3[-1]) else 0.0
    
    atr_vals_5 = talib.SMA(tr, timeperiod=5)
    atr_5 = float(atr_vals_5[-1]) if atr_vals_5 is not None and len(atr_vals_5) > 0 and not np.isnan(atr_vals_5[-1]) else 0.0
    
    atr_vals_14 = talib.SMA(tr, timeperiod=14)
    atr_14 = float(atr_vals_14[-1]) if atr_vals_14 is not None and len(atr_vals_14) > 0 and not np.isnan(atr_vals_14[-1]) else 0.0
    
    long_period = 14400
    if len(rates) < long_period + 1:
        long_period = len(rates) - 1
    if long_period >= 2:
        atr_vals_14400 = talib.SMA(tr, timeperiod=long_period)
        atr_14400 = float(atr_vals_14400[-1]) if atr_vals_14400 is not None and len(atr_vals_14400) > 0 and not np.isnan(atr_vals_14400[-1]) else 0.0
    else:
        atr_14400 = 0.0"""

new_block_2 = """    # Calculate using Wilder's ATR (talib.ATR)
    atr_vals_2 = talib.ATR(high, low, close, timeperiod=2)
    atr_2 = float(atr_vals_2[-2]) if atr_vals_2 is not None and len(atr_vals_2) > 1 and not np.isnan(atr_vals_2[-2]) else 0.0
    
    atr_vals_3 = talib.ATR(high, low, close, timeperiod=3)
    atr_3 = float(atr_vals_3[-2]) if atr_vals_3 is not None and len(atr_vals_3) > 1 and not np.isnan(atr_vals_3[-2]) else 0.0
    
    atr_vals_5 = talib.ATR(high, low, close, timeperiod=5)
    atr_5 = float(atr_vals_5[-2]) if atr_vals_5 is not None and len(atr_vals_5) > 1 and not np.isnan(atr_vals_5[-2]) else 0.0
    
    atr_vals_14 = talib.ATR(high, low, close, timeperiod=14)
    atr_14 = float(atr_vals_14[-2]) if atr_vals_14 is not None and len(atr_vals_14) > 1 and not np.isnan(atr_vals_14[-2]) else 0.0
    
    long_period = 14400
    if len(rates) < long_period + 2:
        long_period = len(rates) - 2
    if long_period >= 2:
        atr_vals_14400 = talib.ATR(high, low, close, timeperiod=long_period)
        atr_14400 = float(atr_vals_14400[-2]) if atr_vals_14400 is not None and len(atr_vals_14400) > 1 and not np.isnan(atr_vals_14400[-2]) else 0.0
    else:
        atr_14400 = 0.0"""

for file_path in bridge_files:
    if os.path.exists(file_path):
        print(f"Modifying {file_path}...")
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        modified = False
        if old_block_1 in content:
            content = content.replace(old_block_1, new_block_1)
            modified = True
        else:
            # Let's try matching with different line endings if any, or normalize newlines
            content_normalized = content.replace("\r\n", "\n")
            old_block_1_normalized = old_block_1.replace("\r\n", "\n")
            if old_block_1_normalized in content_normalized:
                content = content_normalized.replace(old_block_1_normalized, new_block_1)
                modified = True
            else:
                print(f"  WARNING: old_block_1 not found in {file_path}")
            
        if old_block_2 in content:
            content = content.replace(old_block_2, new_block_2)
            modified = True
        else:
            content_normalized = content.replace("\r\n", "\n")
            old_block_2_normalized = old_block_2.replace("\r\n", "\n")
            if old_block_2_normalized in content_normalized:
                content = content_normalized.replace(old_block_2_normalized, new_block_2)
                modified = True
            else:
                print(f"  WARNING: old_block_2 not found in {file_path}")
            
        if modified:
            with open(file_path, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)
            print(f"  Successfully updated {file_path}")
        else:
            print(f"  No changes made to {file_path}")
    else:
        print(f"File {file_path} not found.")

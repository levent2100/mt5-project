import MetaTrader5 as mt5
import numpy as np
import talib
import sys

MT5_PATH = "C:\\Program Files\\MetaTrader 5_1\\terminal64.exe"
symbol = "XAUUSD"

if not mt5.initialize(path=MT5_PATH):
    print("Failed to initialize MT5")
    sys.exit(1)

timeframes = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
}

for name, tf in timeframes.items():
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, 100)
    if rates is None or len(rates) < 15:
        print(f"Failed to copy rates for {name}")
        continue
    
    high = np.array([float(bar['high']) for bar in rates], dtype=np.float64)
    low = np.array([float(bar['low']) for bar in rates], dtype=np.float64)
    close = np.array([float(bar['close']) for bar in rates], dtype=np.float64)
    
    tr = talib.TRANGE(high, low, close)
    
    atr_2 = talib.SMA(tr, timeperiod=2)[-1]
    atr_3 = talib.SMA(tr, timeperiod=3)[-1]
    atr_5 = talib.SMA(tr, timeperiod=5)[-1]
    atr_14 = talib.SMA(tr, timeperiod=14)[-1]
    
    print(f"\nTimeframe {name}:")
    print(f"  ATR 2: {atr_2:.2f}")
    print(f"  ATR 3: {atr_3:.2f}")
    print(f"  ATR 5: {atr_5:.2f}")
    print(f"  ATR 14: {atr_14:.2f}")

mt5.shutdown()

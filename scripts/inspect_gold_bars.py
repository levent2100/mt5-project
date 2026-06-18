import MetaTrader5 as mt5
import numpy as np
import talib
import sys
import datetime

MT5_PATH = "C:\\Program Files\\MetaTrader 5_1\\terminal64.exe"
symbol = "XAUUSD"

if not mt5.initialize(path=MT5_PATH):
    print("Failed to initialize MT5")
    sys.exit(1)

rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 14600)
if rates is None or len(rates) == 0:
    print(f"Failed to copy rates: {mt5.last_error()}")
    mt5.shutdown()
    sys.exit(1)

print(f"Total M1 bars copied: {len(rates)}")
print("\nLast 20 M1 bars:")
now_ts = datetime.datetime.now().timestamp()
for i in range(-20, 0):
    bar = rates[i]
    rng = bar['high'] - bar['low']
    dt = datetime.datetime.fromtimestamp(bar['time'])
    print(f"Index {i} | Time: {dt} ({bar['time']}) | High: {bar['high']:.2f} | Low: {bar['low']:.2f} | Close: {bar['close']:.2f} | Range: {rng:.2f}")

high = np.array([float(bar['high']) for bar in rates], dtype=np.float64)
low = np.array([float(bar['low']) for bar in rates], dtype=np.float64)
close = np.array([float(bar['close']) for bar in rates], dtype=np.float64)

tr = talib.TRANGE(high, low, close)

atr_2 = talib.SMA(tr, timeperiod=2)[-1]
atr_3 = talib.SMA(tr, timeperiod=3)[-1]
atr_5 = talib.SMA(tr, timeperiod=5)[-1]
atr_14 = talib.SMA(tr, timeperiod=14)[-1]

long_period = 14400
if len(rates) < long_period + 1:
    long_period = len(rates) - 1
atr_14400 = talib.SMA(tr, timeperiod=long_period)[-1]

print("\nCalculated ATRs:")
print(f"  ATR 2: {atr_2:.4f}")
print(f"  ATR 3: {atr_3:.4f}")
print(f"  ATR 5: {atr_5:.4f}")
print(f"  ATR 14: {atr_14:.4f}")
print(f"  ATR 14400: {atr_14400:.4f}")
print(f"  Max ATR: {max(atr_2, atr_3, atr_5, atr_14, atr_14400):.4f}")

mt5.shutdown()

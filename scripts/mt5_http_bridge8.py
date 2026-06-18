#!/usr/bin/env python
# -*- coding: utf-8 -*-

# --- Standard Library Imports ---
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
import threading
import json
import time
import logging
from datetime import datetime, time as dt_time
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN, getcontext

# --- Third-Party Imports ---
import MetaTrader5 as mt5
import numpy as np
import talib

# ==============================================================================
# --- Configuration ---
# ==============================================================================
# -- Server Settings --
HOST = '0.0.0.0'
PORT = 58808
LOG_LEVEL = logging.INFO  # Options: DEBUG, INFO, WARNING, ERROR

FILLING_MODE = mt5.ORDER_FILLING_FOK  # Filling policy (FOK, IOC, or RETURN)

# -- MetaTrader 5 Connection Settings --
MT5_LOGIN = 0  # Replace with your account number, or 0 to use the active terminal account
MT5_PASSWORD = ""  # Replace with your password
MT5_SERVER = ""  # Replace with your server name
MT5_PATH = "C:\\Program Files\\MetaTrader 5_8\\terminal64.exe"  # IMPORTANT: Update with your MT5 path

# -- System Parameters --
# Symbols polled to get the most recent server time, ensuring accuracy.
SERVER_TIME_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY"]


# -- Trading Parameters --
MAGIC_NUMBER = 234000  # Unique identifier for trades placed by this script
DEFAULT_SLIPPAGE_DEVIATION = 20  # Default slippage in points for market orders
ENABLE_TIME_STOP = True  # Enable/disable time-based stop monitor
ENABLE_TIMES_STOP = True  # Alias for compatibility

# -- Custom Maximum Lot Sizes (Broker Override) --
MAX_LOT_SIZES = {
   
}

# ==============================================================================
# --- Global State and Setup ---
# ==============================================================================
# Set precision for Decimal calculations to handle financial data accurately.
getcontext().prec = 30

# Setup basic logging configuration.
logging.basicConfig(
    level=LOG_LEVEL,
    format='[%(asctime)s][%(levelname)s][%(threadName)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Cache for currency conversion pairs to avoid repeated slow lookups.
# Format: {"<PROFIT_CURRENCY><ACCOUNT_CURRENCY>": ("<MT5_SYMBOL_NAME>", <is_inverse_bool>)}
_conversion_symbol_cache = {}


# ==============================================================================
# --- MT5 Connection Management ---
# ==============================================================================
class MT5ConnectionManager:
    """ Manages a persistent connection to the MetaTrader 5 terminal. """
    def __init__(self):
        self._connected = False
        self.lock = threading.RLock()

    def connect(self):
        """ Establishes the initial connection to the MT5 terminal. """
        with self.lock:
            logging.info("Attempting to connect to MetaTrader 5...")
            init_params = {"path": MT5_PATH} if MT5_PATH else {}
            if MT5_LOGIN > 0 and MT5_PASSWORD and MT5_SERVER:
                init_params.update({"login": MT5_LOGIN, "password": MT5_PASSWORD, "server": MT5_SERVER})

            if not mt5.initialize(**init_params):
                logging.error(f"MT5 initialize() failed. Error: {mt5.last_error()}")
                if not mt5.initialize(path=MT5_PATH if MT5_PATH else None):
                    logging.critical("Simple MT5 initialization also failed.")
                    self._connected = False
                    return False
            
            account_info = mt5.account_info()
            if not account_info:
                logging.error(f"MT5 connected but failed to get account info. Error: {mt5.last_error()}")
                self._connected = False
                return False
            
            logging.info(f"MT5 connection successful. Account: {account_info.login}, Server: {account_info.server}")
            self._connected = True
            return True

    def ensure_connection(self):
        """ Checks if the MT5 connection is active. If not, attempts to reconnect. """
        if self._connected and mt5.terminal_info():
            return True
        with self.lock:
            if self._connected and mt5.terminal_info():
                return True
            logging.warning("MT5 connection lost or stale. Attempting to reconnect...")
            return self.connect()

    def shutdown(self):
        """ Shuts down the connection to the MT5 terminal. """
        with self.lock:
            if self._connected:
                logging.info("Shutting down MT5 connection...")
                mt5.shutdown()
                self._connected = False

# --- Global instance of the connection manager ---
mt5_manager = MT5ConnectionManager()

# ==============================================================================
# --- Helper & Calculation Functions ---
# ==============================================================================
def ensure_symbol_selected(symbol_name):
    """ Ensures a symbol is visible in the Market Watch so we can retrieve ticks/info. """
    info = mt5.symbol_info(symbol_name)
    if not info:
        if mt5.symbol_select(symbol_name, True):
            time.sleep(0.05)
            return mt5.symbol_info(symbol_name)
        return None
    if not info.visible:
        if mt5.symbol_select(symbol_name, True):
            time.sleep(0.05)
            return mt5.symbol_info(symbol_name)
    return info

def round_price(price, digits):
    """ Rounds a price to the correct number of decimal places for a symbol. """
    return float(Decimal(str(price)).quantize(Decimal('1e-' + str(digits)), rounding=ROUND_HALF_UP))

def get_volume_digits(symbol_info_volume_step):
    """ Calculates the number of decimal places for a symbol's volume. """
    try:
        step_str = "{:.10f}".format(symbol_info_volume_step).rstrip('0')
        return len(step_str.split('.')[1]) if '.' in step_str else 0
    except Exception:
        return 8

def get_max_volume_for_leverage(symbol_info, price, account_info):
    """
    Calculates the maximum lot size allowed under the account's leverage/margin constraints.
    Capped at 95% of the account balance to avoid margin errors on minor fluctuations.
    """
    try:
        # Use 95% of the account balance as the max allowed margin
        allowed_margin = float(account_info.balance) * 0.95
        
        # 1. Try using MT5's built-in order_calc_margin
        # Use ORDER_TYPE_BUY as standard since leverage is usually symmetric
        margin_1_lot = mt5.order_calc_margin(mt5.ORDER_TYPE_BUY, symbol_info.name, 1.0, price)
        if margin_1_lot is not None and margin_1_lot > 0:
            max_vol = allowed_margin / float(margin_1_lot)
            logging.info(f"Max volume for {symbol_info.name} by order_calc_margin: {max_vol} (1 lot margin: {margin_1_lot})")
            return max_vol
    except Exception as e:
        logging.warning(f"Error using order_calc_margin for leverage calculation: {e}")

    # 2. Fallback to manual leverage calculation if order_calc_margin fails
    try:
        leverage = float(account_info.leverage)
        if leverage <= 0:
            leverage = 100.0  # Safe fallback
        
        contract_size = float(symbol_info.trade_contract_size)
        if contract_size <= 0:
            return None
        
        # Determine profit currency to account currency conversion
        conv_rate, err = _get_conversion_rate(account_info.currency, symbol_info.currency_margin)
        if err or conv_rate is None:
            conv_rate, err = _get_conversion_rate(account_info.currency, symbol_info.currency_profit)
            if err or conv_rate is None:
                conv_rate = Decimal("1.0")
        
        price_dec = Decimal(str(price))
        margin_1_lot_manual = (Decimal(str(contract_size)) * price_dec) / (Decimal(str(leverage)) * conv_rate)
        if margin_1_lot_manual > 0:
            max_vol = float(Decimal(str(allowed_margin)) / margin_1_lot_manual)
            logging.info(f"Max volume for {symbol_info.name} by manual leverage: {max_vol} (1 lot margin manual: {margin_1_lot_manual})")
            return max_vol
    except Exception as e:
        logging.error(f"Error in manual leverage fallback calculation: {e}")
        
    return None

def normalize_explicit_volume(requested_qty_str, symbol_info_obj):
    """ Normalizes a requested volume according to the symbol's min, max, step and leverage rules. """
    try:
        requested_qty = Decimal(str(requested_qty_str))
        min_v = Decimal(str(symbol_info_obj.volume_min))
        max_v = Decimal(str(symbol_info_obj.volume_max))
        step_v = Decimal(str(symbol_info_obj.volume_step))
        vol_digits = get_volume_digits(symbol_info_obj.volume_step)
        
        # --- MODIFICATION START ---
        # Check for a broker-specific override from the global dictionary.
        symbol_name = symbol_info_obj.name
        if symbol_name in MAX_LOT_SIZES:
            max_lot_override = MAX_LOT_SIZES[symbol_name]
            # A positive value in the dictionary acts as a new, stricter ceiling.
            if max_lot_override > 0:
                override_dec = Decimal(str(max_lot_override))
                # Use the smaller of the two maximums: the one from the broker (MT5) or our custom override.
                if max_v > override_dec:
                    max_v = override_dec
        
        # Check account max leverage dynamically and enforce a 95% margin volume cap
        account_info = mt5.account_info()
        if account_info:
            tick = mt5.symbol_info_tick(symbol_name)
            if tick and tick.ask > 0:
                price = tick.ask
                max_leverage_vol = get_max_volume_for_leverage(symbol_info_obj, price, account_info)
                if max_leverage_vol is not None and max_leverage_vol > 0:
                    lev_vol_dec = Decimal(str(max_leverage_vol))
                    if max_v > lev_vol_dec:
                        logging.warning(f"[LEVERAGE CAP] Capping maximum volume for {symbol_name} at {lev_vol_dec} based on 95% leverage limit (broker max: {symbol_info_obj.volume_max})")
                        max_v = lev_vol_dec
        # --- MODIFICATION END ---
        
        if min_v <= 0 and requested_qty <= 0: return 0.0, None
        
        current_volume = requested_qty
        if current_volume < min_v:
            logging.warning(f"Requested volume {current_volume} is below platform minimum of {min_v}. Adjusting to minimum.")
            current_volume = min_v
        elif current_volume > max_v:
            logging.warning(f"Requested volume {current_volume} is above platform maximum of {max_v}. Adjusting to maximum.")
            current_volume = max_v
        
        if step_v > 0:
            num_steps = (current_volume / step_v).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
            stepped_volume = num_steps * step_v
            if stepped_volume < min_v and min_v > 0: stepped_volume = min_v
            if stepped_volume > max_v and max_v > 0: stepped_volume = max_v
            current_volume = stepped_volume
            
        final_volume = float(current_volume.quantize(Decimal(f'1e-{vol_digits}'), rounding=ROUND_HALF_UP))
        return final_volume, None
    except Exception as e:
        return None, f"Error normalizing volume: {e}"

def _get_conversion_rate(account_currency, symbol_profit_currency):
    """ Calculates the conversion rate, using a cache to avoid slow lookups. """
    if account_currency == symbol_profit_currency: return Decimal("1.0"), None
    
    pair_key = f"{symbol_profit_currency}{account_currency}"
    if pair_key in _conversion_symbol_cache:
        found_symbol_name, is_inverse = _conversion_symbol_cache[pair_key]
    else:
        found_symbol_name, is_inverse = None, False
        pair_forward, pair_backward = f"{symbol_profit_currency}{account_currency}", f"{account_currency}{symbol_profit_currency}"
        if mt5.symbol_info(pair_forward): found_symbol_name, is_inverse = pair_forward, False
        elif mt5.symbol_info(pair_backward): found_symbol_name, is_inverse = pair_backward, True
        else:
            logging.warning(f"Performing deep search for conversion pair: {pair_key}")
            all_symbols = mt5.symbols_get()
            if not all_symbols: return None, "Could not retrieve symbol list for deep search."
            candidates_fwd = [s.name for s in all_symbols if s.name.startswith(pair_forward)]
            if candidates_fwd: found_symbol_name, is_inverse = min(candidates_fwd, key=len), False
            else:
                candidates_bwd = [s.name for s in all_symbols if s.name.startswith(pair_backward)]
                if candidates_bwd: found_symbol_name, is_inverse = min(candidates_bwd, key=len), True

    if found_symbol_name:
        mt5.symbol_select(found_symbol_name, True)
        tick = mt5.symbol_info_tick(found_symbol_name)
        if not tick: return None, f"Found conversion symbol '{found_symbol_name}' but could not get a valid tick."
        _conversion_symbol_cache[pair_key] = (found_symbol_name, is_inverse)
        if is_inverse: return (Decimal("1.0") / Decimal(str(tick.bid)), None) if tick.bid > 0 else (None, f"Invalid bid price for inverse pair '{found_symbol_name}'.")
        else: return (Decimal(str(tick.ask)), None) if tick.ask > 0 else (None, f"Invalid ask price for pair '{found_symbol_name}'.")
    
    return None, f"CRITICAL: Could not find ANY valid currency conversion pair for {symbol_profit_currency}->{account_currency}."

def calculate_risk_based_volume(risk_percent_str, sl_pips_str, account_info, symbol_info):
    """ Calculates trade volume based on account risk percentage and stop loss. """
    try:
        risk_percent, sl_pips = Decimal(str(risk_percent_str)), Decimal(str(sl_pips_str))
        if risk_percent <= 0 or sl_pips <= 0: return None, "Risk percent and SL pips must be positive numbers."
        risk_amount_acct_curr = Decimal(str(account_info.balance)) * (risk_percent / Decimal('100.0'))
        contract_size = Decimal(str(symbol_info.trade_contract_size))
        if contract_size <= 0: return None, f"Invalid contract size for {symbol_info.name}."
        loss_per_lot_profit_curr = sl_pips * contract_size
        conv_rate, err = _get_conversion_rate(account_info.currency, symbol_info.currency_profit)
        if err: return None, err
        loss_per_lot_acct_curr = loss_per_lot_profit_curr * conv_rate
        if loss_per_lot_acct_curr <= 0: return None, f"Calculated loss per lot is not positive for {symbol_info.name}."
        raw_volume = risk_amount_acct_curr / loss_per_lot_acct_curr
        return normalize_explicit_volume(str(raw_volume), symbol_info)
    except Exception as e:
        return None, f"Error during risk calculation: {e}"

def get_filling_mode(symbol_info):
    """ Resolves the correct type_filling parameter based on symbol's allowed filling modes. """
    if not symbol_info:
        return mt5.ORDER_FILLING_FOK
    mode = symbol_info.filling_mode
    if (mode & 1) != 0:  # SYMBOL_FILLING_FOK
        return mt5.ORDER_FILLING_FOK
    elif (mode & 2) != 0:  # SYMBOL_FILLING_IOC
        return mt5.ORDER_FILLING_IOC
    elif (mode & 4) != 0:  # SYMBOL_FILLING_RETURN
        return mt5.ORDER_FILLING_RETURN
    return mt5.ORDER_FILLING_FOK

def close_mt5_position(position_ticket, position_obj):
    """ Closes a specific MT5 position. """
    if not position_obj: logging.error(f"[{position_ticket}] Cannot close: Position object is None."); return False
    symbol_info, tick = mt5.symbol_info(position_obj.symbol), mt5.symbol_info_tick(position_obj.symbol)
    if not symbol_info or not tick: logging.error(f"[{position_ticket}] Cannot get info/tick to close {position_obj.symbol}."); return False
    is_buy_pos = position_obj.type == mt5.POSITION_TYPE_BUY
    filling_mode = get_filling_mode(symbol_info)
    request = {"action": mt5.TRADE_ACTION_DEAL, "position": position_ticket, "symbol": position_obj.symbol, "volume": position_obj.volume, "type": mt5.ORDER_TYPE_SELL if is_buy_pos else mt5.ORDER_TYPE_BUY, "price": round_price(tick.bid if is_buy_pos else tick.ask, symbol_info.digits), "deviation": DEFAULT_SLIPPAGE_DEVIATION, "magic": MAGIC_NUMBER, "comment": "", "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_mode}
    result = mt5.order_send(request)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE: logging.info(f"Successfully closed position {position_ticket}."); return True
    logging.error(f"[{position_ticket}] Failed closing order. Reason: {result.comment if result else mt5.last_error()}"); return False

def get_latest_server_time():
    """ Gets the most recent server time by polling ticks from major symbols. """
    latest_time = 0
    account_info = mt5.account_info()
    name_conversions = {}
    if account_info:
        settings = get_account_settings(account_info.login)
        name_conversions = settings.get("NameConversions", {})
    
    for symbol in SERVER_TIME_SYMBOLS:
        mapped_symbol = name_conversions.get(symbol, symbol)
        if not mapped_symbol:
            continue
        tick = mt5.symbol_info_tick(mapped_symbol)
        if tick and tick.time > latest_time: latest_time = tick.time
    return latest_time or int(time.time())

_atr_cache = {}
_atr_cache_lock = threading.Lock()

def get_global_settings():
    import os
    paths = [
        "/root/scripts/propfundsettings.json",
        "/pjt_src/mt5-project/scripts/propfundsettings.json",
        "scripts/propfundsettings.json",
        "../scripts/propfundsettings.json"
    ]
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logging.error(f"Error loading global settings from {path}: {e}")
    return {}

def get_bridge_active_symbols():
    global_cfg = get_global_settings()
    global_names = global_cfg.get("GlobalNames", [])
    acc_cfg = get_account_settings(MT5_LOGIN if MT5_LOGIN > 0 else get_expected_login_by_port(PORT))
    name_conversions = acc_cfg.get("NameConversions", {})
    
    active_symbols = []
    for g_sym in global_names:
        b_sym = name_conversions.get(g_sym, g_sym)
        if b_sym and b_sym != "N/A":
            active_symbols.append(b_sym)
    return list(set(active_symbols))

def atr_cache_updater():
    logging.info("ATR Cache Updater thread started.")
    while True:
        try:
            time.sleep(1.0)
            if not mt5_manager.ensure_connection():
                continue
                
            active_symbols = get_bridge_active_symbols()
            if not active_symbols:
                continue
                
            for symbol in active_symbols:
                with mt5_manager.lock:
                    ensure_symbol_selected(symbol)
                    rates_latest = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
                
                if rates_latest is None or len(rates_latest) == 0:
                    continue
                
                latest_time = int(rates_latest[0]['time'])
                
                with _atr_cache_lock:
                    cached = _atr_cache.get(symbol)
                    
                if cached and cached.get("last_bar_time") == latest_time:
                    continue
                
                logging.info(f"Recalculating ATRs for {symbol} (new M1 bar time: {latest_time})")
                with mt5_manager.lock:
                    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 14600)
                
                if rates is None or len(rates) < 15:
                    logging.error(f"Failed to copy historical rates for {symbol} on M1. Error: {mt5.last_error()}")
                    continue
                
                high = np.array([float(bar['high']) for bar in rates], dtype=np.float64)
                low = np.array([float(bar['low']) for bar in rates], dtype=np.float64)
                close = np.array([float(bar['close']) for bar in rates], dtype=np.float64)
                
                # Calculate using Wilder's ATR (talib.ATR)
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
                    atr_14400 = 0.0
                
                max_atr = max(atr_2, atr_3, atr_5, atr_14, atr_14400)
                
                with _atr_cache_lock:
                    _atr_cache[symbol] = {
                        "last_bar_time": latest_time,
                        "max_atr": max_atr,
                        "atr_2": atr_2,
                        "atr_3": atr_3,
                        "atr_5": atr_5,
                        "atr_14": atr_14,
                        "atr_14400": atr_14400
                    }
        except Exception as e:
            logging.error(f"Error in atr_cache_updater loop: {e}")

def calculate_atr(symbol, period=14):
    with _atr_cache_lock:
        cached = _atr_cache.get(symbol)
    if cached:
        return cached["max_atr"]
    
    logging.warning(f"ATR cache miss for {symbol}, performing synchronous fallback.")
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 14600)
    if rates is None or len(rates) < 5:
        return 0.0
        
    high = np.array([float(bar['high']) for bar in rates], dtype=np.float64)
    low = np.array([float(bar['low']) for bar in rates], dtype=np.float64)
    close = np.array([float(bar['close']) for bar in rates], dtype=np.float64)
    
    # Calculate using Wilder's ATR (talib.ATR)
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
        atr_14400 = 0.0
        
    max_atr = max(atr_2, atr_3, atr_5, atr_14, atr_14400)
    
    rates_latest = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
    latest_time = int(rates_latest[0]['time']) if rates_latest is not None and len(rates_latest) > 0 else int(time.time())
    with _atr_cache_lock:
        _atr_cache[symbol] = {
            "last_bar_time": latest_time,
            "max_atr": max_atr,
            "atr_2": atr_2,
            "atr_3": atr_3,
            "atr_5": atr_5,
            "atr_14": atr_14,
            "atr_14400": atr_14400
        }
    return max_atr

def get_account_settings(login_num):
    """
    Loads propfundsettings.json and retrieves the settings dictionary
    for the specified MT5 login number (compared as a string).
    """
    import os
    paths = [
        "/root/scripts/propfundsettings.json",
        "/pjt_src/mt5-project/scripts/propfundsettings.json",
        "scripts/propfundsettings.json",
        "../scripts/propfundsettings.json"
    ]
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                
                # Check MT5Accounts
                mt5_data = data.get("MT5Accounts", {})
                accounts = mt5_data.get("Accounts", [])
                for acc in accounts:
                    if str(acc.get("name")) == str(login_num):
                        return acc
                
                # Also check FutureAccounts just in case
                futures_data = data.get("FutureAccounts", {})
                f_accounts = futures_data.get("Accounts", [])
                for acc in f_accounts:
                    if str(acc.get("name")) == str(login_num):
                        return acc
            except Exception as e:
                logging.error(f"Error loading or parsing {path}: {e}")
    return {}

def get_expected_login_by_port(port):
    """
    Loads propfundsettings.json and retrieves the configured account name
    for the specified bridge port.
    """
    import os
    paths = [
        "/root/scripts/propfundsettings.json",
        "/pjt_src/mt5-project/scripts/propfundsettings.json",
        "scripts/propfundsettings.json",
        "../scripts/propfundsettings.json"
    ]
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                
                # Check MT5Accounts
                mt5_data = data.get("MT5Accounts", {})
                accounts = mt5_data.get("Accounts", [])
                for acc in accounts:
                    ip_port = acc.get("ip_port", "")
                    if f":{port}" in ip_port:
                        return str(acc.get("name"))
                
                # Also check FutureAccounts just in case
                futures_data = data.get("FutureAccounts", {})
                f_accounts = futures_data.get("Accounts", [])
                for acc in f_accounts:
                    ip_port = acc.get("ip_port", "")
                    if f":{port}" in ip_port:
                        return str(acc.get("name"))
            except Exception as e:
                logging.error(f"Error loading or parsing {path}: {e}")
    return None

def time_stop_monitor():
    """
    Background thread that periodically checks all open positions.
    If a position has been open for at least TimeStop seconds and its profit is negative,
    it is closed immediately.
    """
    logging.info("Time-based stop monitor thread started.")
    while True:
        try:
            time.sleep(1.0)  # Check every second
            
            # Check global enablement flags
            if not ENABLE_TIME_STOP or not ENABLE_TIMES_STOP:
                continue
                
            if not mt5_manager.ensure_connection():
                continue
                
            with mt5_manager.lock:
                # Load TimeStop value from propfundsettings.json
                time_stop = 180  # Default fallback
                import os
                paths = [
                    "/root/scripts/propfundsettings.json",
                    "/pjt_src/mt5-project/scripts/propfundsettings.json",
                    "scripts/propfundsettings.json",
                    "../scripts/propfundsettings.json"
                ]
                for path in paths:
                    if os.path.exists(path):
                        try:
                            with open(path, 'r') as f:
                                data = json.load(f)
                            time_stop = data.get("TimeStop", 180)
                            break
                        except Exception:
                            pass
                
                # Get all open positions
                positions = mt5.positions_get()
                if positions:
                    for pos in positions:
                        current_time = get_latest_server_time()
                        elapsed = current_time - pos.time
                        
                        if elapsed >= time_stop:
                            if pos.profit < 0.0:
                                logging.warning(
                                    f"[TIME STOP] Position {pos.ticket} for {pos.symbol} has been open for "
                                    f"{elapsed}s (>= {time_stop}s) and PNL is negative ({pos.profit}). Closing position."
                                )
                                close_mt5_position(pos.ticket, pos)
        except Exception as e:
            logging.error(f"Error in time_stop_monitor: {e}")


# ==============================================================================
# --- HTTP Request Handler ---
# ==============================================================================
class RequestHandler(BaseHTTPRequestHandler):
    """ Handles incoming HTTP POST requests and routes them to the correct handler. """
    def _send_response_headers(self, status_code, content_type):
        self.send_response(status_code)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _send_json_response(self, data, status_code=200):
        self._send_response_headers(status_code, 'application/json')
        self.wfile.write(json.dumps(data, indent=4).encode('utf-8'))

    def _send_error_response(self, message, status_code=400):
        logging.warning(f"Sending Error Response ({status_code}): {message}")
        self._send_json_response({"success": False, "error": message}, status_code)

    def do_OPTIONS(self):
        self._send_response_headers(204, 'text/plain')

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            command = data.get('request', '').lower()
            if not command: return self._send_error_response("'request' field is missing.", 400)
            
            handlers = {
                "trade": self.handle_trade, 
                "accountstatus": self.handle_account_status, 
                "cancelandflatten": self.handle_cancel_flatten, 
                "movestoploss": self.handle_move_stoploss, 
                "getspreads": self.handle_get_spreads, 
                "modify_order": self.handle_modify_order, 
                "cancel_order": self.handle_cancel_order, 
                "manage_position_stops": self.handle_manage_position_stops,
                "getatr": self.handle_get_atr,
                "getallatrs": self.handle_get_all_atrs
            }
            handler = handlers.get(command)

            if handler:
                if command in ["trade", "cancelandflatten", "movestoploss", "modify_order", "cancel_order", "manage_position_stops"]:
                    expected_login = get_expected_login_by_port(PORT)
                    if expected_login:
                        if not mt5_manager.ensure_connection():
                            return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
                        acc_info = mt5.account_info()
                        if not acc_info:
                            return self._send_error_response("Failed to retrieve MT5 account info.", 500)
                        actual_login = str(acc_info.login)
                        if actual_login != expected_login:
                            err_msg = f"Strict account check failed: MT5 terminal is logged into '{actual_login}', but settings configure '{expected_login}' for port {PORT}. Request rejected for safety."
                            logging.critical(err_msg)
                            return self._send_error_response(err_msg, 400)
                handler(data)
            else: self._send_error_response(f"Unknown request type: {command}", 404)
        except json.JSONDecodeError: self._send_error_response("Invalid JSON format in request body.", 400)
        except Exception as e: logging.exception("Unhandled exception during POST request:"); self._send_error_response(f"Internal server error: {e}", 500)

    def _map_mt5_order_type_to_string(self, mt5_type):
        return {mt5.ORDER_TYPE_BUY_LIMIT: "limit", mt5.ORDER_TYPE_SELL_LIMIT: "limit", mt5.ORDER_TYPE_BUY_STOP: "stop", mt5.ORDER_TYPE_SELL_STOP: "stop"}.get(mt5_type, "unknown")

    def handle_trade(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            if mt5.positions_total() > 0: return self._send_error_response("Cannot open new trade: An open position already exists.", 403)
            if mt5.orders_total() > 0: return self._send_error_response("Cannot open new trade: A pending order already exists.", 403)
            if 'trades' not in data or not data['trades']: return self._send_error_response("Invalid request: 'trades' array is missing or empty.", 400)
            account_info = mt5.account_info()
            if not account_info: return self._send_error_response(f"Failed to get account info. Error: {mt5.last_error()}", 500)
            
            # Load active account settings from propfundsettings.json
            account_settings = get_account_settings(account_info.login)
            risk_perc = float(account_settings.get("RiskPerc", 0.0))
            
            results, overall_success = [], True
            for trade in data['trades']:
                result = {"instrument": trade.get("instrument"), "success": False, "error": None, "calculatedVolume": None}
                instrument, o_type, direction = trade.get("instrument"), trade.get("ordertype", "").lower(), trade.get("direction", "").lower()
                if not all([instrument, o_type, direction]): result["error"] = "Missing required fields."; results.append(result); overall_success = False; continue
                
                symbol_info = ensure_symbol_selected(instrument)
                if not symbol_info: result["error"] = f"Instrument '{instrument}' not found."; results.append(result); overall_success = False; continue
                
                tick = mt5.symbol_info_tick(instrument)
                if not tick or tick.ask == 0 or tick.bid == 0: result["error"] = f"No valid tick for {instrument}."; results.append(result); overall_success = False; continue
                
                try:
                    qty_val = float(trade.get("qty") or 0.0)
                    risk_val = float(trade.get("risk") or 0.0)
                except (ValueError, TypeError):
                    result["error"] = "Invalid qty or risk format."
                    results.append(result)
                    overall_success = False
                    continue
                
                # Sizing method selection
                is_risk = False
                final_risk_perc = 0.0
                
                if qty_val > 0:
                    is_risk = False
                elif risk_val > 0:
                    is_risk = True
                    final_risk_perc = risk_val
                elif risk_perc > 0:
                    is_risk = True
                    final_risk_perc = risk_perc
                else:
                    result["error"] = "No sizing method specified (qty or risk must be positive)."
                    results.append(result)
                    overall_success = False
                    continue
                
                # Read sl_pips explicitly passed in the trade request
                sl_pips = float(trade.get("sl_pips") or 0.0)
                
                if is_risk:
                    if sl_pips <= 0:
                        # Fallback to ATR-based default SL if not specified
                        real_atr = calculate_atr(instrument)
                        if real_atr is not None and real_atr > 0:
                            global_cfg = get_global_settings()
                            sl_multiplier = float(global_cfg.get("SL_ATR_Multiplier", 1.0))
                            tick = mt5.symbol_info_tick(instrument)
                            spread = (tick.ask - tick.bid) if (tick and tick.ask > 0 and tick.bid > 0) else 0.0
                            calculated_sl = sl_multiplier * real_atr + spread
                            
                            acc_settings = get_account_settings(account_info.login)
                            name_conversions = acc_settings.get("NameConversions", {})
                            global_symbol = instrument
                            for g_sym, b_sym in name_conversions.items():
                                if b_sym == instrument:
                                    global_symbol = g_sym
                                    break
                            
                            default_sl_pips = float(global_cfg.get("DefaultSLPips", {}).get(global_symbol, 0.0))
                            point_value = float(acc_settings.get("DefaultPointValue", {}).get(global_symbol, 0.0001))
                            
                            sl_pips = max(calculated_sl, default_sl_pips * point_value)
                        else:
                            sl_pips = 0.0020  # Safe generic fallback
                    vol, err = calculate_risk_based_volume(str(final_risk_perc), str(sl_pips), account_info, symbol_info)
                else:
                    if sl_pips <= 0:
                        real_atr = calculate_atr(instrument)
                        if real_atr is not None and real_atr > 0:
                            global_cfg = get_global_settings()
                            sl_multiplier = float(global_cfg.get("SL_ATR_Multiplier", 1.0))
                            tick = mt5.symbol_info_tick(instrument)
                            spread = (tick.ask - tick.bid) if (tick and tick.ask > 0 and tick.bid > 0) else 0.0
                            calculated_sl = sl_multiplier * real_atr + spread
                            
                            acc_settings = get_account_settings(account_info.login)
                            name_conversions = acc_settings.get("NameConversions", {})
                            global_symbol = instrument
                            for g_sym, b_sym in name_conversions.items():
                                if b_sym == instrument:
                                    global_symbol = g_sym
                                    break
                            
                            default_sl_pips = float(global_cfg.get("DefaultSLPips", {}).get(global_symbol, 0.0))
                            point_value = float(acc_settings.get("DefaultPointValue", {}).get(global_symbol, 0.0001))
                            
                            sl_pips = max(calculated_sl, default_sl_pips * point_value)
                        else:
                            sl_pips = 0.0020  # Safe generic fallback
                    vol, err = normalize_explicit_volume(str(qty_val), symbol_info)
                
                if err: result["error"] = err; results.append(result); overall_success = False; continue
                
                result["calculatedVolume"] = vol
                if not vol or vol <= 0: result["error"] = result.get("error") or "Calculated volume is invalid."; results.append(result); overall_success = False; continue
                
                is_buy, price, order_type = direction == "buy", 0.0, None
                ask, bid, mid, offset_val = tick.ask, tick.bid, (tick.ask + tick.bid) / 2.0, float(trade.get("offset_pips", 0.0))
                
                if is_buy:
                    if o_type in ["market", "limit_ask"]: price, order_type = ask, mt5.ORDER_TYPE_BUY
                    elif o_type == "mid": price, order_type = mid, mt5.ORDER_TYPE_BUY_LIMIT
                    elif o_type == "join_bid": price, order_type = bid, mt5.ORDER_TYPE_BUY_LIMIT
                    elif o_type in ["offset", "offset_buy"]: price, order_type = bid - offset_val, mt5.ORDER_TYPE_BUY_LIMIT
                else: # Sell
                    if o_type in ["market", "limit_bid"]: price, order_type = bid, mt5.ORDER_TYPE_SELL
                    elif o_type == "join_ask": price, order_type = ask, mt5.ORDER_TYPE_SELL_LIMIT
                    elif o_type == "mid": price, order_type = mid, mt5.ORDER_TYPE_SELL_LIMIT
                    elif o_type in ["offset", "offset_sell"]: price, order_type = ask + offset_val, mt5.ORDER_TYPE_SELL_LIMIT
                
                tp_pips = float(trade.get("tp_pips") or 0.0)
                if tp_pips <= 0 and sl_pips > 0:
                    global_cfg = get_global_settings()
                    tp_multiplier = float(global_cfg.get("TP_Multiplier", 2.0))
                    tp_pips = tp_multiplier * sl_pips
                sl = price - sl_pips if is_buy else price + sl_pips
                tp = price + tp_pips if is_buy else price - tp_pips
                is_market = order_type in [mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_SELL]
                filling_mode = get_filling_mode(symbol_info)
                
                request = {"action": mt5.TRADE_ACTION_DEAL if is_market else mt5.TRADE_ACTION_PENDING, "symbol": instrument, "volume": vol, "type": order_type, "price": round_price(price, symbol_info.digits), "sl": round_price(sl, symbol_info.digits) if sl_pips > 0 else 0.0, "tp": round_price(tp, symbol_info.digits) if tp_pips > 0 else 0.0, "deviation": DEFAULT_SLIPPAGE_DEVIATION, "magic": MAGIC_NUMBER, "comment": "", "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_mode}
                order_result = mt5.order_send(request)
                
                if order_result and order_result.retcode in [mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED]: result["success"], result["orderId"] = True, str(order_result.order)
                else: result["error"] = f"Order failed. Ret: {order_result.retcode if order_result else 'N/A'} - {order_result.comment if order_result else mt5.last_error()}"; logging.error(f"{result['error']}. Req: {request}"); overall_success = False
                results.append(result)
            self._send_json_response({"success": overall_success, "results": results})

    def handle_modify_order(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            instrument, new_price_type, offset_pips = data.get("instrument"), data.get("new_price_type", "").lower(), float(data.get("offset_pips", 0.0))
            if not instrument or not new_price_type: return self._send_error_response("Missing 'instrument' or 'new_price_type'", 400)
            orders = mt5.orders_get(symbol=instrument)
            if not orders: return self._send_error_response(f"No pending order for {instrument} to modify.", 404)
            if len(orders) > 1: return self._send_error_response(f"Multiple pending orders for {instrument}.", 409)
            order, symbol_info, tick = orders[0], mt5.symbol_info(instrument), mt5.symbol_info_tick(instrument)
            if not symbol_info or not tick: return self._send_error_response(f"Could not get info/tick for {instrument}.", 500)
            is_buy_order = order.type in [mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP]
            
            if new_price_type == "market" or (is_buy_order and new_price_type == "ask") or (not is_buy_order and new_price_type == "bid"):
                if mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": order.ticket}).retcode != mt5.TRADE_RETCODE_DONE: return self._send_error_response(f"Failed to cancel order {order.ticket} before moving to market.", 500)
                filling_mode = get_filling_mode(symbol_info)
                market_req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": order.symbol, "volume": order.volume_initial, "type": mt5.ORDER_TYPE_BUY if is_buy_order else mt5.ORDER_TYPE_SELL, "price": tick.ask if is_buy_order else tick.bid, "sl": order.sl, "tp": order.tp, "deviation": DEFAULT_SLIPPAGE_DEVIATION, "magic": MAGIC_NUMBER, "comment": "", "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling_mode}
                market_res = mt5.order_send(market_req)
                if market_res and market_res.retcode == mt5.TRADE_RETCODE_DONE: self._send_json_response({"success": True, "message": f"Order {order.ticket} moved to market."})
                else: self._send_error_response(f"Failed to send market order. Result: {market_res.comment if market_res else 'N/A'}", 500)
                return
            
            new_price = 0.0; ask, bid, mid = tick.ask, tick.bid, (tick.ask + tick.bid) / 2.0
            if is_buy_order:
                if new_price_type == "mid": new_price = mid
                elif new_price_type == "bid": new_price = bid
                elif new_price_type == "offset": new_price = bid - offset_pips
            else:
                if new_price_type == "ask": new_price = ask
                elif new_price_type == "mid": new_price = mid
                elif new_price_type == "offset": new_price = ask + offset_pips
            
            if new_price <= 0: return self._send_error_response(f"Calculated new price is invalid ({new_price})", 400)
            modify_req = {"action": mt5.TRADE_ACTION_MODIFY, "order": order.ticket, "price": round_price(new_price, symbol_info.digits), "sl": order.sl, "tp": order.tp}
            result = mt5.order_send(modify_req)
            if result and result.retcode == mt5.TRADE_RETCODE_DONE: self._send_json_response({"success": True, "message": f"Order {order.ticket} modified to {modify_req['price']}."})
            else: self._send_error_response(f"Failed to modify order {order.ticket}. Result: {result.comment if result else 'N/A'}", 500)

    def handle_cancel_order(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            instrument = data.get("instrument")
            if not instrument: return self._send_error_response("Missing 'instrument' field", 400)
            orders = mt5.orders_get(symbol=instrument)
            if not orders: return self._send_error_response(f"No pending order for {instrument} to cancel.", 404)
            if len(orders) > 1: return self._send_error_response(f"Multiple pending orders for {instrument}.", 409)
            result = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": orders[0].ticket})
            if result and result.retcode == mt5.TRADE_RETCODE_DONE: self._send_json_response({"success": True, "message": f"Order {orders[0].ticket} for {instrument} cancelled."})
            else: self._send_error_response(f"Failed to cancel order {orders[0].ticket}. Result: {result.comment if result else 'N/A'}", 500)

    def handle_manage_position_stops(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            # CORRECTED: Assign payload first, then use it to get the instrument.
            payload = data.get("payload", {})
            instrument = payload.get("symbol")
            if not instrument: return self._send_error_response("Missing 'symbol' in payload", 400)
            
            positions = mt5.positions_get(symbol=instrument)
            if not positions: return self._send_error_response(f"No open position for {instrument}.", 404)
            if len(positions) > 1: return self._send_error_response(f"Multiple positions for {instrument}.", 409)
            
            position = positions[0]; symbol_info, tick = mt5.symbol_info(instrument), mt5.symbol_info_tick(instrument)
            if not symbol_info or not tick: return self._send_error_response(f"Could not get info/tick for {instrument}.", 500)
            
            is_buy, new_sl, new_tp = position.type == mt5.POSITION_TYPE_BUY, position.sl, position.tp
            
            if 'sl' in payload:
                sl_data  = payload['sl']
                sl_type= sl_data.get('type')

                if sl_type == 'breakeven': new_sl = position.price_open
                elif sl_type in ['pips_from_entry', 'pips_from_mid']:
                    base = position.price_open if sl_type == 'pips_from_entry' else (tick.ask + tick.bid) / 2.0
                    new_sl = base - float(sl_data.get('value', 0)) if is_buy else base + float(sl_data.get('value', 0))
                elif sl_type == 'price_level': new_sl = {'bid': tick.bid, 'mid': (tick.ask+tick.bid)/2.0, 'ask': tick.ask}.get(sl_data.get('value'), new_sl)
            
            if 'tp' in payload:
                tp_data = payload['tp']
                tp_type = tp_data.get('type')

                if tp_type == 'breakeven': new_tp = position.price_open
                elif tp_type in ['pips_from_entry', 'pips_from_mid']:
                    base = position.price_open if tp_type == 'pips_from_entry' else (tick.ask + tick.bid) / 2.0
                    new_tp = base + float(tp_data.get('value', 0)) if is_buy else base - float(tp_data.get('value', 0))
                elif tp_type == 'price_level': new_tp = {'bid': tick.bid, 'mid': (tick.ask+tick.bid)/2.0, 'ask': tick.ask}.get(tp_data.get('value'), new_tp)
            
            request = {"action": mt5.TRADE_ACTION_SLTP, "position": position.ticket, "symbol": instrument, "sl": round_price(new_sl, symbol_info.digits), "tp": round_price(new_tp, symbol_info.digits)}
            result = mt5.order_send(request)
            
            if result and result.retcode == mt5.TRADE_RETCODE_DONE: self._send_json_response({"success": True, "message": f"Position {position.ticket} SL/TP updated."})
            else: self._send_error_response(f"Failed to update SL/TP. Result: {result.comment if result else 'N/A'}", 500)

    def handle_move_stoploss(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            instrument = data.get("instrument")
            if not instrument: return self._send_error_response("Invalid request: 'instrument' field is missing.", 400)
            
            positions = mt5.positions_get(symbol=instrument)
            if not positions: return self._send_error_response(f"No open position for '{instrument}'.", 404)
            
            position, symbol_info = positions[0], mt5.symbol_info(instrument)
            if not symbol_info: return self._send_error_response(f"Could not get symbol info for {instrument}.", 500)
            
            request = {"action": mt5.TRADE_ACTION_SLTP, "position": position.ticket, "symbol": instrument, "sl": round_price(position.price_open, symbol_info.digits), "tp": position.tp}
            result = mt5.order_send(request)
            
            if result and result.retcode == mt5.TRADE_RETCODE_DONE: self._send_json_response({"success": True, "message": f"SL moved to breakeven for {position.ticket}."})
            else: self._send_error_response(f"Failed to move SL. Result: {result.comment if result else 'N/A'}", 500)
        
    def handle_get_spreads(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            acc_info = mt5.account_info()
            if not acc_info: return self._send_error_response("Failed to get account info.", 500)
            
            instruments = data.get("instruments")
            if not instruments: return self._send_error_response("'instruments' array is missing.", 400)
            
            spreads, errors = {}, []
            for inst in instruments:
                if not inst or inst == "N/A":
                    continue
                symbol_info = ensure_symbol_selected(inst)
                if not symbol_info: errors.append({inst: "Symbol not found."}); spreads[inst] = None; continue
                tick = mt5.symbol_info_tick(inst)
                if not tick or tick.ask == 0.0 or tick.bid == 0.0: errors.append({inst: "No valid tick data."}); spreads[inst] = None; continue
                spreads[inst] = round(tick.ask - tick.bid, symbol_info.digits)
            
            final_response = {"success": True, "accounts": [{"account": str(acc_info.login), "spreads": spreads}]}
            if errors: final_response.update({"message": "Could not retrieve all spreads.", "errors": errors})
            
            self._send_json_response(final_response)
            
    def handle_get_atr(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            instrument = data.get("instrument")
            if not instrument: return self._send_error_response("Missing 'instrument' field", 400)
            
            symbol_info = ensure_symbol_selected(instrument)
            if not symbol_info: return self._send_error_response(f"Instrument '{instrument}' not found.", 404)
            
            atr = calculate_atr(instrument)
            if atr is None:
                return self._send_error_response(f"Failed to calculate ATR for {instrument}.", 500)
            
            # Fetch current spread as well
            tick = mt5.symbol_info_tick(instrument)
            spread = (tick.ask - tick.bid) if (tick and tick.ask > 0 and tick.bid > 0) else 0.0
            
            self._send_json_response({
                "success": True,
                "instrument": instrument,
                "atr": atr,
                "spread": spread
            })
            
    def handle_get_all_atrs(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            instruments = data.get("instruments", [])
            results = {}
            for instrument in instruments:
                symbol_info = ensure_symbol_selected(instrument)
                if not symbol_info:
                    continue
                atr = calculate_atr(instrument)
                if atr is None:
                    continue
                tick = mt5.symbol_info_tick(instrument)
                spread = (tick.ask - tick.bid) if (tick and tick.ask > 0 and tick.bid > 0) else 0.0
                results[instrument] = {
                    "atr": atr,
                    "spread": spread
                }
            self._send_json_response({
                "success": True,
                "results": results
            })
            
     
    def handle_account_status(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock: 
        
            try:
                acc_info = mt5.account_info()
                if not acc_info:
                    self._send_error_response(f"Failed to get account info. LastError: {mt5.last_error()}", 500)
                    return
                
                detail = {
                    "account": str(acc_info.login), 
                    "positions": [],
                    "orders": [],
                    "total_unrealized": float(acc_info.profit), 
                    "total_realized": 0.0, 
                    "cash_value": float(acc_info.balance), 
                    "buying_power": float(acc_info.margin_free), 
                    "trading_disabled_today": False 
                }

                try:
                    server_time_now = get_latest_server_time()
                    if server_time_now > 0:
                        server_time_dt = datetime.fromtimestamp(server_time_now)
                        start_of_day_dt = server_time_dt.replace(hour=0, minute=0, second=0, microsecond=0)
                        # We want deals up to the current time, not the end of the day
                        end_of_day_ts = server_time_now
                        start_of_day_ts = int(start_of_day_dt.timestamp())
                    else: # Fallback
                        today_dt_obj = datetime.now()
                        start_of_day_dt = datetime.combine(today_dt_obj.date(), dt_time.min)
                        end_of_day_dt = datetime.combine(today_dt_obj.date(), dt_time.max)
                        start_of_day_ts = int(start_of_day_dt.timestamp())
                        end_of_day_ts = int(end_of_day_dt.timestamp())
                    
                    deals = mt5.history_deals_get(start_of_day_ts, end_of_day_ts)
                    todays_realized_pnl_val = Decimal('0.0')
                    if deals is None:
                         logging.warning(f"Could not get history deals for today ({start_of_day_dt.date()}). LastError: {mt5.last_error()}")
                    elif deals:
                        for d in deals:
                            if d.entry == mt5.DEAL_ENTRY_OUT or d.entry == mt5.DEAL_ENTRY_INOUT : 
                                todays_realized_pnl_val += Decimal(str(d.profit)) + 2 * Decimal(str(d.commission)) + Decimal(str(d.swap))
                        detail["total_realized"] = float(todays_realized_pnl_val) 
                except Exception as hist_ex:
                    logging.error(f"Error calculating realized PNL from history deals: {hist_ex}")
                    detail["total_realized"] = 0.0 

                positions = mt5.positions_get(login=acc_info.login) 
                if positions is None:
                    logging.warning(f"Failed to get open positions. LastError: {mt5.last_error()}")
                else:
                     for pos in positions:
                         position_info = {
                             "instrument": pos.symbol,
                             "quantity": pos.volume * (1 if pos.type == mt5.POSITION_TYPE_BUY else -1),
                             "direction": ("buy" if pos.type == mt5.POSITION_TYPE_BUY else "sell"),
                             "avgprice": pos.price_open, 
                             "PNL": pos.profit, 
                         }
                         detail["positions"].append(position_info)

                orders = mt5.orders_get(login=acc_info.login)
                if orders is None:
                     logging.warning(f"Failed to get active orders. LastError: {mt5.last_error()}")
                else:
                     for order in orders:
                         order_price = 0.0
                         if order.type in [mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_SELL_LIMIT,
                                           mt5.ORDER_TYPE_BUY_STOP, mt5.ORDER_TYPE_SELL_STOP,
                                           mt5.ORDER_TYPE_BUY_STOP_LIMIT, mt5.ORDER_TYPE_SELL_STOP_LIMIT]:
                             order_price = order.price_open
                         
                         order_info = {
                             "instrument": order.symbol,
                             "direction": "buy" if order.type in [mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP, mt5.ORDER_TYPE_BUY_STOP_LIMIT] else "sell",
                             "ordertype": self._map_mt5_order_type_to_string(order.type),
                             "quantity": order.volume_initial, 
                             "price": order_price, 
                         }
                         detail["orders"].append(order_info)
                
                self._send_json_response({"accounts": [detail]})

            except Exception as e:
                logging.exception("Exception during account status retrieval:")
                self._send_error_response(f"Internal server error getting account status: {e}", 500)
                return
            
    def handle_cancel_flatten(self, data):
        if not mt5_manager.ensure_connection(): return self._send_error_response("Failed to connect to MetaTrader 5.", 503)
        with mt5_manager.lock:
            target_instrument = data.get("instrument")
            result, actions_log = {"success": True, "message": "", "error": None}, []
            
            orders = mt5.orders_get() or []
            orders_to_cancel = [o for o in orders if not target_instrument or o.symbol == target_instrument]
            if orders_to_cancel:
                cancelled_count = sum(1 for o in orders_to_cancel if mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": o.ticket}).retcode == mt5.TRADE_RETCODE_DONE)
                actions_log.append(f"{cancelled_count}/{len(orders_to_cancel)} orders cancelled.")
                if cancelled_count < len(orders_to_cancel): result["success"] = False; result["error"] = "Failed to cancel one or more orders. "
            
            positions = mt5.positions_get() or []
            positions_to_flatten = [p for p in positions if not target_instrument or p.symbol == target_instrument]
            if positions_to_flatten:
                flattened_count = sum(1 for p in positions_to_flatten if close_mt5_position(p.ticket, p))
                actions_log.append(f"{flattened_count}/{len(positions_to_flatten)} positions flattened.")
                if flattened_count < len(positions_to_flatten): result["success"] = False; result["error"] = (result.get("error") or "") + "Failed to flatten one or more positions."
            
            if not actions_log: actions_log.append("No open orders or positions to act on.")
            result["message"] = " ".join(actions_log)
            self._send_json_response({"success": result["success"], "results": [result]})

# ==============================================================================
# --- Server Execution ---
# ==============================================================================
class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """ A server that handles each request in a new thread. """
    daemon_threads = True

def run_server():
    """ Initializes the service and starts the HTTP server. """
    server = None
    try:
        if not mt5_manager.connect():
            logging.critical("Halting: Could not establish initial MT5 connection.")
            return
        
        # Start background time-stop monitor thread
        monitor_thread = threading.Thread(target=time_stop_monitor, name="TimeStopMonitor", daemon=True)
        monitor_thread.start()
        
        # Start background ATR cache updater thread
        atr_thread = threading.Thread(target=atr_cache_updater, name="AtrCacheUpdater", daemon=True)
        atr_thread.start()
        
        server_address = (HOST, PORT)
        server = ThreadingHTTPServer(server_address, RequestHandler)
        logging.info(f"HTTP Server starting on http://{HOST}:{PORT}")
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Shutting down server...")
    except Exception as e:
        logging.exception("A critical error occurred in the server:")
    finally:
        if server:
            server.server_close()
        mt5_manager.shutdown()
        logging.info("Script finished.")

if __name__ == '__main__':
    run_server()
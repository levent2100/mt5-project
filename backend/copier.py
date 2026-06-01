import asyncio
import logging
from typing import Dict, Any, List, Optional
from backend.config import settings
from backend.bridge_client import BridgeClient

logger = logging.getLogger("backend.copier")

class TradeCopier:
    def __init__(self):
        # We will re-read settings configuration dynamically in case it gets reloaded
        pass

    def get_active_accounts(self) -> List[Dict[str, Any]]:
        """Returns only accounts that are enabled for trading in propfundsettings.json."""
        settings.load()
        all_accounts = settings.get_all_accounts()
        # Ensure only accounts with trade_enabled=True are selected
        active_accs = [acc for acc in all_accounts if acc.get("trade_enabled", False)]
        logger.info(f"Retrieved {len(active_accs)} active accounts for copying.")
        return active_accs

    def get_reference_account(self) -> Optional[Dict[str, Any]]:
        """Returns the reference account configuration to query system-wide metrics (e.g. ATR)."""
        settings.load()
        ref_name = settings.reference_acc_name
        all_accounts = settings.get_all_accounts()
        for acc in all_accounts:
            if acc.get("name") == ref_name:
                return acc
        # Fallback to the first active MT5 account
        active_mt5 = [acc for acc in all_accounts if acc.get("type") == "MT5" and acc.get("trade_enabled")]
        if active_mt5:
            return active_mt5[0]
        return None

    async def get_atr(self, symbol_global: str) -> Dict[str, Any]:
        """Fetch ATR for a symbol from the reference account's bridge."""
        ref_acc = self.get_reference_account()
        if not ref_acc:
            return {"success": False, "error": "No reference account configured or active."}
        
        ip_port = ref_acc.get("ip_port")
        if not ip_port:
            return {"success": False, "error": "Reference account has no ip_port."}
        
        name_conversions = ref_acc.get("NameConversions", {})
        symbol_broker = name_conversions.get(symbol_global, symbol_global)
        if symbol_broker == "N/A":
            return {"success": False, "error": f"Symbol {symbol_global} is N/A on reference account."}
            
        client = BridgeClient(ip_port)
        res = await client._post("getatr", {"instrument": symbol_broker})
        if res.get("success", False):
            # Calculate ATR in pips based on reference account's DefaultPointValue
            raw_atr = float(res.get("atr", 0.0))
            point_value_dict = ref_acc.get("DefaultPointValue", {})
            point_value = float(point_value_dict.get(symbol_global, 0.0001))
            atr_pips = raw_atr / point_value if point_value > 0 else raw_atr
            
            # Dynamic Floor Safety Constraint: 2x ATR cannot be smaller than DefaultSLPips
            settings.load()
            default_sl_dict = settings.default_sl_pips
            default_sl = float(default_sl_dict.get(symbol_global, 0.0))
            if default_sl > 0:
                min_atr_pips = default_sl / 2.0
                if atr_pips < min_atr_pips:
                    logger.info(f"[ATR FLOOR] Capping atr_pips for {symbol_global} at {min_atr_pips} (calculated: {atr_pips}) to satisfy 2x ATR >= {default_sl} pips.")
                    atr_pips = min_atr_pips
                    raw_atr = atr_pips * point_value
            
            return {
                "success": True,
                "instrument": symbol_global,
                "atr_raw": raw_atr,
                "atr_pips": atr_pips
            }
        return {"success": False, "error": res.get("error", "Failed to fetch ATR from bridge")}

    async def copy_trade(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Distribute a trade request from UI to all active accounts, scaling by their DefaultPointValue.
        """
        symbol_global = payload.get("symbol", "")
        direction = payload.get("direction", "")
        ordertype = payload.get("ordertype", "market")
        qty_ui = float(payload.get("qty", 0.0))
        sl_pips = float(payload.get("sl_pips", 0.0))
        tp_pips = float(payload.get("tp_pips", 0.0))
        offset_pips = float(payload.get("offset_pips", 0.0))

        # Enforce default Stop Loss only if no stop loss was explicitly specified (sl_pips == 0)
        settings.load()
        default_sl_dict = settings.default_sl_pips
        min_sl = float(default_sl_dict.get(symbol_global, 0.0))
        if sl_pips <= 0:
            sl_pips = min_sl

        # Default TP to 2.0 * SL if not specified
        if tp_pips == 0 and sl_pips > 0:
            tp_pips = 2.0 * sl_pips

        active_accounts = self.get_active_accounts()
        if not active_accounts:
            return {"success": False, "message": "No active trading accounts configured."}

        tasks = []
        account_names = []

        for acc in active_accounts:
            acc_name = acc.get("name", "Unknown")
            ip_port = acc.get("ip_port")
            if not ip_port:
                logger.warning(f"Account {acc_name} has no ip_port configured, skipping.")
                continue

            # 1. Translate symbol name using account NameConversions
            name_conversions = acc.get("NameConversions", {})
            symbol_broker = name_conversions.get(symbol_global, symbol_global)
            
            if symbol_broker == "N/A":
                logger.info(f"Skipping trade for account {acc_name}: Symbol conversion is N/A.")
                continue

            # 2. Scale pip parameters by DefaultPointValue
            point_value_dict = acc.get("DefaultPointValue", {})
            point_value = float(point_value_dict.get(symbol_global, 0.0001))
            
            scaled_sl = sl_pips * point_value
            scaled_tp = tp_pips * point_value
            scaled_offset = offset_pips * point_value

            # 3. Determine scaled lot size or risk
            # Override if payload explicitly sets a custom risk percentage, or default to acc.RiskPerc if no explicit qty
            is_risk_based = False
            custom_risk = float(payload.get("risk", 0.0))
            if custom_risk > 0:
                is_risk_based = True
                risk_perc = custom_risk
            elif acc.get("RiskPerc", 0.0) > 0 and qty_ui <= 0:
                is_risk_based = True
                risk_perc = float(acc.get("RiskPerc"))
            else:
                is_risk_based = False
                risk_perc = 0.0

            multiplier = float(acc.get("Multiplier", 1.0))

            trade_payload = {
                "instrument": symbol_broker,
                "direction": direction,
                "ordertype": ordertype,
                "sl_pips": scaled_sl,
                "tp_pips": scaled_tp,
                "offset_pips": scaled_offset
            }

            if is_risk_based:
                trade_payload["risk"] = risk_perc
                trade_payload["qty"] = 0.0
            else:
                base_qty = qty_ui
                if base_qty <= 0:
                    default_lots = acc.get("DefaultLotSizes", {})
                    base_qty = float(default_lots.get(symbol_global, 1.0))
                
                trade_payload["qty"] = base_qty
                trade_payload["risk"] = 0.0

            client = BridgeClient(ip_port)
            tasks.append(client.execute_trade([trade_payload]))
            account_names.append(acc_name)

        if not tasks:
            return {"success": False, "message": f"No accounts could accept trades for {symbol_global}."}

        logger.info(f"Concurrently copying trade to accounts: {account_names}")
        results = await asyncio.gather(*tasks, return_exceptions=True)

        summary_results = []
        overall_success = True
        
        for name, res in zip(account_names, results):
            if isinstance(res, Exception):
                overall_success = False
                summary_results.append({
                    "account": name,
                    "success": False,
                    "error": f"Failed with exception: {res}"
                })
            else:
                if not res.get("success", False):
                    overall_success = False
                summary_results.append({
                    "account": name,
                    "success": res.get("success", False),
                    "error": res.get("error") or (res.get("results")[0].get("error") if "results" in res else None)
                })

        message = f"Trades executed. Successful on {sum(1 for r in summary_results if r['success'])}/{len(summary_results)} accounts."
        return {
            "success": overall_success,
            "message": message,
            "details": summary_results
        }

    async def copy_modify_order(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Concurrently modify pending orders across all active accounts."""
        symbol_global = payload.get("symbol")
        new_price_type = payload.get("new_price_type", "").lower()
        offset_pips = float(payload.get("offset_pips", 0.0))

        if not symbol_global or not new_price_type:
            return {"success": False, "message": "Missing 'symbol' or 'new_price_type' in payload."}

        active_accounts = self.get_active_accounts()
        if not active_accounts:
            return {"success": False, "message": "No active trading accounts configured."}

        tasks = []
        account_names = []

        for acc in active_accounts:
            acc_name = acc.get("name", "Unknown")
            ip_port = acc.get("ip_port")
            if not ip_port:
                continue

            name_conversions = acc.get("NameConversions", {})
            symbol_broker = name_conversions.get(symbol_global, symbol_global)
            if symbol_broker == "N/A":
                continue

            # Scale offset_pips by account's DefaultPointValue
            point_value_dict = acc.get("DefaultPointValue", {})
            point_value = float(point_value_dict.get(symbol_global, 0.0001))
            scaled_offset = offset_pips * point_value

            client = BridgeClient(ip_port)
            tasks.append(client.modify_order(symbol_broker, new_price_type, scaled_offset))
            account_names.append(acc_name)

        if not tasks:
            return {"success": False, "message": "No active accounts to modify pending orders."}

        results = await asyncio.gather(*tasks, return_exceptions=True)

        summary_results = []
        for name, res in zip(account_names, results):
            if isinstance(res, Exception):
                summary_results.append({"account": name, "success": False, "error": str(res)})
            else:
                summary_results.append({
                    "account": name,
                    "success": res.get("success", False),
                    "message": res.get("message", res.get("error", ""))
                })

        return {
            "success": all(r["success"] for r in summary_results),
            "message": f"Modify order completed across {len(summary_results)} active accounts.",
            "details": summary_results
        }

    async def copy_manage_position_stops(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Concurrently update position stop loss / take profit across active accounts."""
        symbol_global = payload.get("symbol")
        if not symbol_global:
            return {"success": False, "message": "Missing 'symbol' in payload."}

        active_accounts = self.get_active_accounts()
        if not active_accounts:
            return {"success": False, "message": "No active trading accounts configured."}

        tasks = []
        account_names = []

        for acc in active_accounts:
            acc_name = acc.get("name", "Unknown")
            ip_port = acc.get("ip_port")
            if not ip_port:
                continue

            name_conversions = acc.get("NameConversions", {})
            symbol_broker = name_conversions.get(symbol_global, symbol_global)
            if symbol_broker == "N/A":
                continue

            # Scale sl/tp values by account's DefaultPointValue if they are pip-based
            point_value_dict = acc.get("DefaultPointValue", {})
            point_value = float(point_value_dict.get(symbol_global, 0.0001))

            sl_payload = None
            if "sl" in payload:
                sl_payload = payload["sl"].copy()
                if sl_payload.get("type") in ["pips_from_entry", "pips_from_mid"]:
                    sl_payload["value"] = float(sl_payload.get("value", 0.0)) * point_value

            tp_payload = None
            if "tp" in payload:
                tp_payload = payload["tp"].copy()
                if tp_payload.get("type") in ["pips_from_entry", "pips_from_mid"]:
                    tp_payload["value"] = float(tp_payload.get("value", 0.0)) * point_value

            client = BridgeClient(ip_port)
            tasks.append(client.manage_position_stops(symbol_broker, sl_payload, tp_payload))
            account_names.append(acc_name)

        if not tasks:
            return {"success": False, "message": "No active accounts to manage position stops."}

        results = await asyncio.gather(*tasks, return_exceptions=True)

        summary_results = []
        for name, res in zip(account_names, results):
            if isinstance(res, Exception):
                summary_results.append({"account": name, "success": False, "error": str(res)})
            else:
                summary_results.append({
                    "account": name,
                    "success": res.get("success", False),
                    "message": res.get("message", res.get("error", ""))
                })

        return {
            "success": all(r["success"] for r in summary_results),
            "message": f"Manage position stops completed across {len(summary_results)} active accounts.",
            "details": summary_results
        }

    async def copy_flatten(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Concurrently flatten open positions and pending orders on all active accounts."""
        symbol_global = payload.get("instrument")  # optional filter

        active_accounts = self.get_active_accounts()
        if not active_accounts:
            return {"success": False, "message": "No active trading accounts configured."}

        tasks = []
        account_names = []

        for acc in active_accounts:
            acc_name = acc.get("name", "Unknown")
            ip_port = acc.get("ip_port")
            if not ip_port:
                continue

            # Translate symbol if symbol filter is specified
            symbol_broker = None
            if symbol_global:
                name_conversions = acc.get("NameConversions", {})
                symbol_broker = name_conversions.get(symbol_global, symbol_global)
                if symbol_broker == "N/A":
                    logger.info(f"Skipping flatten on account {acc_name} for symbol {symbol_global} (conversion is N/A)")
                    continue

            client = BridgeClient(ip_port)
            tasks.append(client.cancel_and_flatten(symbol_broker))
            account_names.append(acc_name)

        if not tasks:
            return {"success": False, "message": "No accounts to flatten."}

        results = await asyncio.gather(*tasks, return_exceptions=True)

        summary_results = []
        for name, res in zip(account_names, results):
            if isinstance(res, Exception):
                summary_results.append({"account": name, "success": False, "error": str(res)})
            else:
                summary_results.append({
                    "account": name,
                    "success": res.get("success", False),
                    "message": res.get("message") or (res.get("results")[0].get("message") if "results" in res else "")
                })

        return {
            "success": all(r["success"] for r in summary_results),
            "message": f"Flatten complete across {len(summary_results)} active accounts.",
            "details": summary_results
        }

    async def copy_cancel_pending(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Cancel all pending orders across all active accounts."""
        symbol_global = payload.get("instrument")

        active_accounts = self.get_active_accounts()
        if not active_accounts:
            return {"success": False, "message": "No active trading accounts configured."}

        tasks = []
        account_names = []

        for acc in active_accounts:
            acc_name = acc.get("name", "Unknown")
            ip_port = acc.get("ip_port")
            if not ip_port:
                continue

            symbol_broker = None
            if symbol_global:
                name_conversions = acc.get("NameConversions", {})
                symbol_broker = name_conversions.get(symbol_global, symbol_global)
                if symbol_broker == "N/A":
                    continue

            client = BridgeClient(ip_port)
            if symbol_broker:
                tasks.append(client.cancel_order(symbol_broker))
            else:
                pass
            account_names.append(acc_name)

        # For the sake of function parity, let's fetch active orders from each account,
        # and then send cancel_order for each symbol.
        async def cancel_for_account(acc_dict: Dict[str, Any]) -> Dict[str, Any]:
            ip_port = acc_dict.get("ip_port")
            client = BridgeClient(ip_port)
            status = await client.get_account_status()
            if not status.get("success"):
                return {"success": False, "error": status.get("error")}
            
            orders = status["account_data"].get("orders", [])
            if not orders:
                return {"success": True, "message": "No pending orders to cancel."}
            
            # Unique symbols
            symbols = list(set(o.get("instrument") for o in orders if o.get("instrument")))
            cancel_tasks = [client.cancel_order(sym) for sym in symbols]
            cancel_results = await asyncio.gather(*cancel_tasks, return_exceptions=True)
            
            return {
                "success": True,
                "message": f"Cancelled pending orders for symbols: {symbols}"
            }

        acc_tasks = [cancel_for_account(acc) for acc in active_accounts]
        results = await asyncio.gather(*acc_tasks, return_exceptions=True)

        summary_results = []
        for acc, res in zip(active_accounts, results):
            name = acc.get("name", "Unknown")
            if isinstance(res, Exception):
                summary_results.append({"account": name, "success": False, "error": str(res)})
            else:
                summary_results.append({
                    "account": name,
                    "success": res.get("success", False),
                    "message": res.get("message", "")
                })

        return {
            "success": all(r["success"] for r in summary_results),
            "message": "Pending orders cancellation request processed.",
            "details": summary_results
        }

# Global copier instance
copier = TradeCopier()

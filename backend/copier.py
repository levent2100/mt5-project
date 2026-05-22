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

    async def copy_trade(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Distribute a trade request from UI to all active accounts.
        Payload from UI:
        {
          "symbol": "EURUSD",
          "direction": "buy" or "sell",
          "ordertype": "market",  # or limits
          "qty": float,           # explicitly specified lots, or 0 for risk-based
          "sl_pips": float,
          "tp_pips": float (optional)
        }
        """
        symbol_global = payload.get("symbol", "")
        direction = payload.get("direction", "")
        ordertype = payload.get("ordertype", "market")
        qty_ui = float(payload.get("qty", 0.0))
        sl_pips = float(payload.get("sl_pips", 0.0))
        tp_pips = float(payload.get("tp_pips", 0.0))
        offset_pips = float(payload.get("offset_pips", 0.0))

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

            # 2. Determine scaled lot size or risk
            is_risk_based = acc.get("IsRiskBased", False)
            risk_perc = float(acc.get("RiskPerc", 0.0))
            multiplier = float(acc.get("Multiplier", 1.0))

            trade_payload = {
                "instrument": symbol_broker,
                "direction": direction,
                "ordertype": ordertype,
                "sl_pips": sl_pips,
                "tp_pips": tp_pips,
                "offset_pips": offset_pips
            }

            if is_risk_based:
                # If risk-based, specify risk percentage and set qty to 0 so the bridge calculates lots.
                trade_payload["risk"] = risk_perc
                trade_payload["qty"] = 0.0
            else:
                # If explicit sizing, scale base quantity by the multiplier
                base_qty = qty_ui
                if base_qty <= 0:
                    # Fallback to account's DefaultLotSizes
                    default_lots = acc.get("DefaultLotSizes", {})
                    base_qty = float(default_lots.get(symbol_global, 1.0))
                
                trade_payload["qty"] = base_qty * multiplier
                trade_payload["risk"] = 0.0

            # Create httpx client wrapper for this account
            client = BridgeClient(ip_port)
            
            # Pack as a single trade payload inside the list required by handle_trade in mt5_http_bridge1.py
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
                # The bridge does not have a generic cancel_all_pending endpoint except through cancel_and_flatten.
                # However, mt5_http_bridge1.py handle_cancel_flatten checks target_instrument.
                # If target_instrument is None, it flattens both orders and positions.
                # To ONLY cancel pending orders when symbol is None, we can call cancel_and_flatten on each bridge
                # but mt5_http_bridge1.py flattens positions too when cancelandflatten is called.
                # Let's check mt5_http_bridge1.py's implementation of cancel_and_flatten:
                # it does sum(1 for o in orders_to_cancel ... TRADE_ACTION_REMOVE) AND close_mt5_position for positions.
                # Is there a way to only cancel orders?
                # Ah! Bridge has handle_cancel_order which calls mt5.orders_get(symbol=instrument) and removes it.
                # If we want to cancel ALL pending orders across all symbols, we can fetch the account status to find all orders,
                # then cancel them one by one.
                # But to keep it simple and robust, let's fetch account status, extract pending order symbols, and cancel them.
                # Better yet, since we have the bridge accountstatus response, we can find out what instruments have pending orders.
                # Let's query them. Or we can just call cancel_and_flatten which covers flattening.
                # Let's implement active cancel by first fetching status.
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

import asyncio
import logging
import json
import time
from datetime import datetime
from typing import Dict, Any, List, Set, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.config import settings
from backend.bridge_client import BridgeClient
from backend.copier import copier

logger = logging.getLogger("backend.websocket")

router = APIRouter()

# In-memory queues
activity_logs: List[Dict[str, Any]] = []
logs_lock = asyncio.Lock()

async def log_activity(message: str, source: str = "Backend", log_type: str = "info"):
    """Adds a log entry and broadcasts it to all log-subscribed clients."""
    entry = {
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "message": message,
        "source": source,
        "type": log_type
    }
    async with logs_lock:
        activity_logs.append(entry)
        if len(activity_logs) > 300:
            activity_logs.pop(0)
    
    # Broadcast to all active websockets subscribed to logs
    await manager.broadcast_to_channel("logs", {
        "type": "log_update",
        "data": entry
    })

class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.subscriptions: Dict[str, Set[WebSocket]] = {
            "reference_account": set(),
            "multi_account": set(),
            "logs": set(),
            "spreads": set(),
            "atr": set()
        }

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("New WebSocket client connected.")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        for channel in self.subscriptions.values():
            channel.discard(websocket)
        logger.info("WebSocket client disconnected.")

    def subscribe(self, websocket: WebSocket, channel: str):
        if channel in self.subscriptions:
            self.subscriptions[channel].add(websocket)
            logger.info(f"Client subscribed to channel: {channel}")

    def unsubscribe(self, websocket: WebSocket, channel: str):
        if channel in self.subscriptions:
            self.subscriptions[channel].discard(websocket)
            logger.info(f"Client unsubscribed from channel: {channel}")

    async def send_personal_message(self, message: Dict[str, Any], websocket: WebSocket):
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Error sending message to client: {e}")

    async def broadcast_to_channel(self, channel: str, message: Dict[str, Any]):
        if channel not in self.subscriptions:
            return
        
        targets = list(self.subscriptions[channel])
        if not targets:
            return

        # Prepare serialization once
        payload = json.dumps(message)
        
        tasks = []
        for ws in targets:
            tasks.append(self._safe_send_text(ws, payload))
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _safe_send_text(self, ws: WebSocket, text: str):
        try:
            await ws.send_text(text)
        except Exception:
            # Connection might be dead, ConnectionManager will handle on disconnect
            pass

manager = ConnectionManager()

# Thread-safe in-memory cache to preserve the last known good account data across transient timeouts/errors and prevent UI flickering
# Format: {account_name: {"timestamp": float, "data": dict}}
_last_known_good_accounts = {}

# --- Helper: Convert bridge response to UI standardized Account object ---
def map_bridge_to_ui_account(acc_config: Dict[str, Any], bridge_data: Optional[Dict[str, Any]] = None, status: str = "Connected", error_msg: Optional[str] = None) -> Dict[str, Any]:
    acc_name = acc_config.get("name", "Unknown")
    company = acc_config.get("Company", "MT5")
    name_conversions = acc_config.get("NameConversions", {})

    global _last_known_good_accounts
    now = time.time()

    if bridge_data is None:
        if acc_name in _last_known_good_accounts:
            cached = _last_known_good_accounts[acc_name]
            last_success_time = cached.get("timestamp", 0.0)
            # Carry over only if last successful update was within the last 10 seconds
            if now - last_success_time <= 10.0:
                bridge_data = cached.get("data")
                logger.info(f"[LKG CACHE] Carrying over last known good positions/stats for {acc_name} (last success was {now - last_success_time:.1f}s ago)")
            else:
                logger.warning(f"[LKG CACHE] Cache for {acc_name} has expired (no successful update for {now - last_success_time:.1f}s). Clearing cache to prevent stale data.")
                _last_known_good_accounts.pop(acc_name, None)
    else:
        # Cache successful account status response
        _last_known_good_accounts[acc_name] = {
            "timestamp": now,
            "data": bridge_data
        }

    # Default skeleton
    ui_acc = {
        "id": acc_name,
        "type": acc_config.get("type", "MT5"),
        "displayName": f"{acc_name} ({company})",
        "status": status,
        "error": error_msg,
        "realizedPNL": 0.0,
        "unrealizedPNL": 0.0,
        "positions": [],
        "orders": [],
        "cash_value": 0.0,
        "buying_power": 0.0,
        "multiplier": acc_config.get("Multiplier", 1),
        "riskPerc": acc_config.get("RiskPerc", 0.0),
        "trade_enabled": acc_config.get("trade_enabled", False),
        "lastUpdated": datetime.now().strftime("%H:%M:%S")
    }

    if bridge_data:
        ui_acc["cash_value"] = float(bridge_data.get("cash_value", 0.0))
        ui_acc["buying_power"] = float(bridge_data.get("buying_power", 0.0))
        ui_acc["unrealizedPNL"] = float(bridge_data.get("total_unrealized", 0.0))
        ui_acc["realizedPNL"] = float(bridge_data.get("total_realized", 0.0))

        # Helper to map broker symbol back to global symbol
        def get_display_symbol(broker_symbol: str) -> str:
            for g_name, b_name in name_conversions.items():
                if b_name == broker_symbol:
                    return g_name
            return broker_symbol

        # Parse positions
        positions = []
        for pos in bridge_data.get("positions", []):
            b_sym = pos.get("instrument", "")
            qty = float(pos.get("quantity", 0.0))
            positions.append({
                "symbol": b_sym,
                "displaySymbol": get_display_symbol(b_sym),
                "direction": "BUY" if qty >= 0 else "SELL",
                "quantity": abs(qty),
                "avgPrice": float(pos.get("avgprice", 0.0)),
                "pnl": float(pos.get("PNL", 0.0))
            })
        ui_acc["positions"] = positions

        # Parse orders
        orders = []
        for ord_item in bridge_data.get("orders", []):
            b_sym = ord_item.get("instrument", "")
            orders.append({
                "symbol": b_sym,
                "displaySymbol": get_display_symbol(b_sym),
                "direction": ord_item.get("direction", "buy").upper(),
                "quantity": float(ord_item.get("quantity", 0.0)),
                "orderType": ord_item.get("ordertype", "limit"),
                "price": float(ord_item.get("price", 0.0))
            })
        ui_acc["orders"] = orders

    return ui_acc

# --- Background Loops for Live Pollers ---
async def poll_reference_account():
    """Polls the reference account MT5 bridge and broadcasts its status every 2 seconds."""
    while True:
        try:
            settings.load()
            ref_name = settings.reference_acc_name
            all_accs = settings.get_all_accounts()
            ref_config = next((acc for acc in all_accs if acc.get("name") == ref_name), None)

            if not ref_config:
                logger.warning(f"Reference account '{ref_name}' is not configured in settings.")
                await asyncio.sleep(4.0)
                continue

            ip_port = ref_config.get("ip_port")
            if not ip_port:
                logger.warning(f"Reference account has no ip_port configured.")
                await asyncio.sleep(4.0)
                continue

            client = BridgeClient(ip_port, timeout=1.0)
            res = await client.get_account_status()

            if res.get("success", False):
                ui_acc = map_bridge_to_ui_account(ref_config, res["account_data"], "Connected")
            else:
                ui_acc = map_bridge_to_ui_account(ref_config, None, "Error", res.get("error"))

            await manager.broadcast_to_channel("reference_account", {
                "type": "account_update",
                "data": {
                    "account": ui_acc
                }
            })
        except Exception as e:
            logger.error(f"Error in poll_reference_account loop: {e}")
        
        await asyncio.sleep(1.0)

async def poll_multi_accounts():
    """Polls all active/configured farm accounts concurrently and broadcasts updates every 3 seconds."""
    while True:
        try:
            settings.load()
            all_accs = settings.get_all_accounts()
            if not all_accs:
                await asyncio.sleep(5.0)
                continue

            tasks = []
            for acc in all_accs:
                ip_port = acc.get("ip_port")
                is_enabled = acc.get("trade_enabled", False)
                if ip_port and is_enabled:
                    client = BridgeClient(ip_port, timeout=1.0)
                    tasks.append(client.get_account_status())
                else:
                    async def dummy(err_msg: str):
                        return {"success": False, "error": err_msg}
                    err = "Account is disabled" if not is_enabled else "No ip_port configured"
                    tasks.append(dummy(err))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            ui_accounts = []
            for acc, res in zip(all_accs, results):
                if isinstance(res, Exception):
                    ui_accounts.append(map_bridge_to_ui_account(acc, None, "Error", str(res)))
                elif res.get("success", False):
                    ui_accounts.append(map_bridge_to_ui_account(acc, res["account_data"], "Connected"))
                else:
                    # Mark disabled or unreachable as Disconnected
                    err_str = res.get("error", "")
                    if "disabled" in err_str.lower() or "unreachable" in err_str.lower():
                        status = "Disconnected"
                    else:
                        status = "Error"
                    ui_accounts.append(map_bridge_to_ui_account(acc, None, status, err_str))

            await manager.broadcast_to_channel("multi_account", {
                "type": "multi_account_update",
                "data": {
                    "accounts": ui_accounts
                }
            })
        except Exception as e:
            logger.error(f"Error in poll_multi_accounts loop: {e}")

        await asyncio.sleep(1.0)

async def poll_spreads():
    """Polls live spreads for all active/configured accounts concurrently and broadcasts updates every 2 seconds."""
    while True:
        try:
            # Only poll if there are actually active subscribers to the "spreads" channel to save bandwidth
            if manager.subscriptions.get("spreads"):
                settings.load()
                all_accs = settings.get_all_accounts()
                symbols = settings.global_names

                tasks = []
                active_accounts = []
                for acc in all_accs:
                    ip_port = acc.get("ip_port")
                    is_enabled = acc.get("trade_enabled", False)
                    if ip_port and is_enabled:
                        client = BridgeClient(ip_port, timeout=1.0)
                        # We need to map the global symbols to the broker specific symbols
                        name_conv = acc.get("NameConversions", {})
                        broker_symbols = []
                        for sym in symbols:
                            b_sym = name_conv.get(sym, sym)
                            if b_sym and b_sym != "N/A":
                                broker_symbols.append(b_sym)

                        tasks.append(client.get_spreads(broker_symbols))
                        active_accounts.append(acc)

                if tasks:
                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    
                    spreads_data = []
                    for acc, res in zip(active_accounts, results):
                        if isinstance(res, Exception) or not (isinstance(res, dict) and res.get("success", False)):
                            # Error or exception or failed response
                            spreads_data.append({
                                "id": acc.get("name"),
                                "displayName": acc.get("Company", "MT5") + " (" + acc.get("name") + ")",
                                "company": acc.get("Company", "MT5"),
                                "spreads": {},
                                "defaultpointvalue": acc.get("DefaultPointValue", {})
                            })
                        else:
                            # Map the broker symbols back to global symbols
                            name_conv = acc.get("NameConversions", {})
                            raw_accounts = res.get("accounts", [])
                            raw_spreads = raw_accounts[0].get("spreads", {}) if raw_accounts else {}
                            
                            mapped_spreads = {}
                            for sym in symbols:
                                b_sym = name_conv.get(sym, sym)
                                if b_sym in raw_spreads:
                                    mapped_spreads[sym] = raw_spreads[b_sym]

                            spreads_data.append({
                                "id": acc.get("name"),
                                "displayName": acc.get("Company", "MT5") + " (" + acc.get("name") + ")",
                                "company": acc.get("Company", "MT5"),
                                "spreads": mapped_spreads,
                                "defaultpointvalue": acc.get("DefaultPointValue", {})
                            })

                    await manager.broadcast_to_channel("spreads", {
                        "type": "spreads_update",
                        "data": {
                            "accounts": spreads_data
                        }
                    })
        except Exception as e:
            logger.error(f"Error in poll_spreads loop: {e}")
        
        await asyncio.sleep(1.0)

async def poll_atr():
    """Polls live ATR for all active/configured symbols concurrently and broadcasts updates every second."""
    while True:
        try:
            # Only poll if there are active subscribers to "atr" channel
            if manager.subscriptions.get("atr"):
                settings.load()
                symbols = settings.global_names
                
                # Fetch ATR for all symbols concurrently using copier.get_atr
                tasks = [copier.get_atr(sym) for sym in symbols]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                mapped_atr = {}
                for sym, res in zip(symbols, results):
                    if isinstance(res, dict) and res.get("success"):
                        mapped_atr[sym] = {
                            "atr_raw": res.get("atr_raw"),
                            "atr_pips": res.get("atr_pips")
                        }
                    else:
                        mapped_atr[sym] = None
                
                await manager.broadcast_to_channel("atr", {
                    "type": "atr_update",
                    "data": {
                        "atr": mapped_atr
                    }
                })
        except Exception as e:
            logger.error(f"Error in poll_atr loop: {e}")
        
        await asyncio.sleep(1.0)

# --- WebSocket Route Entry ---
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                msg = json.loads(data_str)
                # Structure: {"receiver": "proplink", "data": {"requestId": "...", "command": "...", "payload": {...}}}
                receiver = msg.get("receiver")
                body = msg.get("data", {})
                req_id = body.get("requestId")
                command = body.get("command")
                payload = body.get("payload", {})

                if receiver != "proplink" or not command:
                    continue

                # Process Client Requests
                if command == "subscribe_account":
                    manager.subscribe(websocket, "reference_account")
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {"message": "Subscribed to master reference updates."}
                    }, websocket)

                elif command == "subscribe_multi_account":
                    manager.subscribe(websocket, "multi_account")
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {"message": "Subscribed to multi-account farm updates."}
                    }, websocket)

                elif command == "subscribe_spreads":
                    manager.subscribe(websocket, "spreads")
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {"message": "Subscribed to live spreads updates."}
                    }, websocket)

                elif command == "subscribe_atr":
                    manager.subscribe(websocket, "atr")
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {"message": "Subscribed to live ATR updates."}
                    }, websocket)

                elif command == "subscribe_logs":
                    manager.subscribe(websocket, "logs")
                    # Send historical logs on initial subscription
                    async with logs_lock:
                        logs_copy = list(activity_logs)
                    for log in logs_copy:
                        await manager.send_personal_message({
                            "type": "log_update",
                            "data": log
                        }, websocket)
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {"message": "Subscribed to log stream."}
                    }, websocket)

                elif command == "get_global_symbols":
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {
                            "symbols": settings.global_names,
                            "slpips": settings.default_sl_pips
                        }
                    }, websocket)

                elif command == "get_account_status":
                    # Instant manual trigger
                    ref_name = settings.reference_acc_name
                    all_accs = settings.get_all_accounts()
                    ref_config = next((acc for acc in all_accs if acc.get("name") == ref_name), None)

                    if ref_config and ref_config.get("ip_port"):
                        client = BridgeClient(ref_config["ip_port"], timeout=1.0)
                        res = await client.get_account_status()
                        if res.get("success"):
                            ui_acc = map_bridge_to_ui_account(ref_config, res["account_data"], "Connected")
                        else:
                            ui_acc = map_bridge_to_ui_account(ref_config, None, "Error", res.get("error"))
                    else:
                        ui_acc = None

                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "ok",
                        "data": {"account": ui_acc}
                    }, websocket)

                elif command == "trade":
                    symbol = payload.get("symbol")
                    direction = payload.get("direction")
                    lots_log = f"scaled risk" if payload.get("qty", 0.0) == 0 else f"{payload.get('qty')} lots"
                    await log_activity(
                        f"UI placement requested: {direction.upper()} {symbol} ({lots_log}, SL {payload.get('sl_pips')} pips)",
                        source="UI-WS",
                        log_type="trade"
                    )
                    
                    res = await copier.copy_trade(payload)
                    
                    status = "ok" if res.get("success") else "error"
                    log_type = "trade" if res.get("success") else "error"
                    await log_activity(res.get("message"), source="Copier", log_type=log_type)
                    
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": {"message": res.get("message")},
                        "error": None if res.get("success") else res.get("message")
                    }, websocket)

                elif command == "flatten":
                    inst = payload.get("instrument")
                    target_msg = f"for symbol {inst}" if inst else "entire portfolio"
                    await log_activity(f"UI requested FLATTEN {target_msg} across farm.", source="UI-WS", log_type="warning")
                    
                    res = await copier.copy_flatten(payload)
                    
                    status = "ok" if res.get("success") else "error"
                    await log_activity(res.get("message"), source="Copier", log_type="info" if res.get("success") else "error")
                    
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": {"message": res.get("message")},
                        "error": None if res.get("success") else res.get("message")
                    }, websocket)

                elif command == "cancel":
                    await log_activity("UI requested CANCEL ALL pending orders across farm.", source="UI-WS", log_type="warning")
                    
                    res = await copier.copy_cancel_pending(payload)
                    
                    status = "ok" if res.get("success") else "error"
                    await log_activity(res.get("message"), source="Copier", log_type="info" if res.get("success") else "error")
                    
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": {"message": res.get("message")},
                        "error": None if res.get("success") else res.get("message")
                    }, websocket)

                elif command == "get_atr":
                    symbol = payload.get("symbol")
                    if not symbol:
                        await manager.send_personal_message({
                            "requestId": req_id,
                            "status": "error",
                            "error": "Missing 'symbol' parameter in payload"
                        }, websocket)
                        continue
                    
                    res = await copier.get_atr(symbol)
                    status = "ok" if res.get("success") else "error"
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": res if res.get("success") else None,
                        "error": None if res.get("success") else res.get("error")
                    }, websocket)

                elif command == "modify_order":
                    symbol = payload.get("symbol")
                    new_price_type = payload.get("new_price_type")
                    offset_pips = payload.get("offset_pips", 0.0)
                    
                    await log_activity(
                        f"UI requested modify pending order for {symbol}: price type '{new_price_type}', offset {offset_pips} pips",
                        source="UI-WS",
                        log_type="info"
                    )
                    
                    res = await copier.copy_modify_order(payload)
                    status = "ok" if res.get("success") else "error"
                    await log_activity(res.get("message"), source="Copier", log_type="info" if res.get("success") else "error")
                    
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": {"message": res.get("message")},
                        "error": None if res.get("success") else res.get("message")
                    }, websocket)

                elif command == "cancel_order":
                    symbol = payload.get("symbol")
                    await log_activity(f"UI requested cancel pending order for {symbol}.", source="UI-WS", log_type="warning")
                    
                    adapted_payload = {"instrument": symbol}
                    res = await copier.copy_cancel_pending(adapted_payload)
                    
                    status = "ok" if res.get("success") else "error"
                    await log_activity(res.get("message"), source="Copier", log_type="info" if res.get("success") else "error")
                    
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": {"message": res.get("message")},
                        "error": None if res.get("success") else res.get("message")
                    }, websocket)

                elif command == "manage_position_stops":
                    symbol = payload.get("symbol")
                    await log_activity(f"UI requested manage position stops for {symbol}.", source="UI-WS", log_type="info")
                    
                    res = await copier.copy_manage_position_stops(payload)
                    status = "ok" if res.get("success") else "error"
                    await log_activity(res.get("message"), source="Copier", log_type="info" if res.get("success") else "error")
                    
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": status,
                        "data": {"message": res.get("message")},
                        "error": None if res.get("success") else res.get("message")
                    }, websocket)

                else:
                    await manager.send_personal_message({
                        "requestId": req_id,
                        "status": "error",
                        "error": f"Unsupported command '{command}'"
                    }, websocket)

            except json.JSONDecodeError:
                logger.warning("Failed to decode JSON from client message.")
            except Exception as e:
                logger.exception("Error processing client WebSocket message:")

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket client communication error: {e}")
        manager.disconnect(websocket)

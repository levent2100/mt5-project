import os

bridge_files = [f"scripts/mt5_http_bridge{i}.py" for i in range(1, 12)]

old_handlers = """            handlers = {
                "trade": self.handle_trade, 
                "accountstatus": self.handle_account_status, 
                "cancelandflatten": self.handle_cancel_flatten, 
                "movestoploss": self.handle_move_stoploss, 
                "getspreads": self.handle_get_spreads, 
                "modify_order": self.handle_modify_order, 
                "cancel_order": self.handle_cancel_order, 
                "manage_position_stops": self.handle_manage_position_stops,
                "getatr": self.handle_get_atr
            }"""

new_handlers = """            handlers = {
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
            }"""

old_handler_code = """            self._send_json_response({
                "success": True,
                "instrument": instrument,
                "atr": atr,
                "spread": spread
            })"""

new_handler_code = """            self._send_json_response({
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
            })"""

for file_path in bridge_files:
    if os.path.exists(file_path):
        print(f"Modifying {file_path}...")
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        modified = False
        if old_handlers in content:
            content = content.replace(old_handlers, new_handlers)
            modified = True
        else:
            print(f"  WARNING: old_handlers not found in {file_path}")
            
        if old_handler_code in content:
            content = content.replace(old_handler_code, new_handler_code)
            modified = True
        else:
            print(f"  WARNING: old_handler_code not found in {file_path}")
            
        if modified:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  Successfully updated {file_path}")
        else:
            print(f"  No changes made to {file_path}")
    else:
        print(f"File {file_path} not found.")

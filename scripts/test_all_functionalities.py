#!/usr/bin/env python
# -*- coding: utf-8 -*-

import asyncio
import json
import uuid
import sys
import logging

try:
    import websockets
except ImportError:
    print("Error: 'websockets' package is required. Run 'pip install websockets' inside your container environment.")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s][%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("CockpitTest")

WS_URL = "ws://127.0.0.1:9999/ws"

class CockpitTester:
    def __init__(self):
        self.ws = None
        self.has_initial_position = False

    async def connect(self):
        logger.info(f"Connecting to FastAPI WebSocket at {WS_URL}...")
        self.ws = await websockets.connect(WS_URL)
        logger.info("Connected successfully!")

    async def send_request(self, command: str, payload: dict = None) -> dict:
        req_id = str(uuid.uuid4())
        msg = {
            "receiver": "proplink",
            "data": {
                "requestId": req_id,
                "command": command,
                "payload": payload or {}
            }
        }
        await self.ws.send(json.dumps(msg))
        logger.info(f"Sent command: {command} (req_id: {req_id[:8]})")
        
        # Wait for the specific response matching req_id
        while True:
            resp_str = await self.ws.recv()
            resp = json.loads(resp_str)
            if resp.get("requestId") == req_id:
                return resp
            # Otherwise it's a broadcast message, ignore or log it at debug level
            logger.debug(f"Ignored broadcast/other msg: {resp_str[:100]}")

    async def run_tests(self):
        try:
            await self.connect()

            # --- TEST 1: Retrieve Global Symbols ---
            print("\n" + "="*60)
            print("TEST 1: get_global_symbols")
            print("="*60)
            resp = await self.send_request("get_global_symbols")
            if resp.get("status") == "ok":
                data = resp.get("data", {})
                print(f"[SUCCESS] Global symbols: {data.get('symbols')}")
                print(f"[SUCCESS] Default SL values: {data.get('slpips')}")
            else:
                print(f"[FAIL] get_global_symbols failed: {resp.get('error')}")
                return

            # --- TEST 2: Query Account Status ---
            print("\n" + "="*60)
            print("TEST 2: get_account_status")
            print("="*60)
            resp = await self.send_request("get_account_status")
            if resp.get("status") == "ok":
                data = resp.get("data", {})
                acc = data.get("account")
                if acc:
                    print(f"[SUCCESS] Reference account name: {acc.get('name')}")
                    print(f"[SUCCESS] Balance: {acc.get('cash_value')} | Free Margin: {acc.get('buying_power')}")
                    print(f"[SUCCESS] Active Positions: {acc.get('positions')}")
                    print(f"[SUCCESS] Active Orders: {acc.get('orders')}")
                    self.has_initial_position = len(acc.get("positions", [])) > 0
                else:
                    print("[WARN] No active reference account detected.")
            else:
                print(f"[FAIL] get_account_status failed: {resp.get('error')}")
                return

            # --- TEST 3: Retrieve ATR Volatility ---
            print("\n" + "="*60)
            print("TEST 3: get_atr")
            print("="*60)
            resp = await self.send_request("get_atr", {"symbol": "EURUSD"})
            atr_pips = 0.0
            if resp.get("status") == "ok":
                data = resp.get("data", {})
                print(f"[SUCCESS] ATR calculated successfully using TA-Lib!")
                print(f"[SUCCESS] Raw ATR: {data.get('atr_raw')}")
                print(f"[SUCCESS] ATR in Pips: {data.get('atr_pips')}")
                atr_pips = float(data.get("atr_pips", 0.0))
            else:
                print(f"[FAIL] get_atr failed: {resp.get('error')}")
                return

            # --- TEST 4: Manage Active Position Stops ---
            print("\n" + "="*60)
            print("TEST 4: manage_position_stops")
            print("="*60)
            
            placed_temp_trade = False
            if not self.has_initial_position:
                print("No initial position detected. Placing a temporary market order for TEST 4...")
                trade_resp = await self.send_request("trade", {
                    "symbol": "EURUSD",
                    "direction": "buy",
                    "ordertype": "market",
                    "qty": 0.1,
                    "sl_pips": 25.0,
                    "tp_pips": 50.0
                })
                if trade_resp.get("status") == "ok":
                    print("[SUCCESS] Placed temporary trade for testing stops.")
                    placed_temp_trade = True
                else:
                    print(f"[WARN] Failed to place temporary trade: {trade_resp.get('error')}")
            
            if self.has_initial_position or placed_temp_trade:
                # Send SL/TP adjustment command to manage active EURUSD position
                sl_payload = {"type": "pips_from_entry", "value": 30}
                tp_payload = {"type": "pips_from_entry", "value": 60}
                resp = await self.send_request("manage_position_stops", {
                    "symbol": "EURUSD",
                    "sl": sl_payload,
                    "tp": tp_payload
                })
                if resp.get("status") == "ok":
                    print(f"[SUCCESS] Position stops modified: {resp.get('data', {}).get('message')}")
                else:
                    print(f"[FAIL] manage_position_stops failed: {resp.get('error')}")
                    print(f"Full response details: {json.dumps(resp, indent=2)}")
            else:
                print("[WARN] Skipping TEST 4 because no active position could be established.")

            # --- TEST 5: Portfolio Flatten ---
            print("\n" + "="*60)
            print("TEST 5: flatten (Cleaning up the slate for staged entries)")
            print("="*60)
            resp = await self.send_request("flatten", {"instrument": "EURUSD"})
            if resp.get("status") == "ok":
                print(f"[SUCCESS] Flatten executed: {resp.get('data', {}).get('message')}")
            else:
                print(f"[FAIL] Flatten failed: {resp.get('error')}")
                return

            # --- TEST 6: Pending Offset Staged Entry ---
            print("\n" + "="*60)
            print("TEST 6: trade (Placing staged BUY LIMIT with 20 pips offset)")
            print("="*60)
            resp = await self.send_request("trade", {
                "symbol": "EURUSD",
                "direction": "buy",
                "ordertype": "offset",
                "qty": 0.5,
                "sl_pips": 25.0,
                "tp_pips": 50.0,
                "offset_pips": 20.0
            })
            if resp.get("status") == "ok":
                print(f"[SUCCESS] Pending offset order placed: {resp.get('data', {}).get('message')}")
            else:
                print(f"[FAIL] Staged pending entry placement failed: {resp.get('error')}")
                return

            # --- TEST 7: Pending Order Modification ---
            print("\n" + "="*60)
            print("TEST 7: modify_order (Shifting pending order to MID price)")
            print("="*60)
            resp = await self.send_request("modify_order", {
                "symbol": "EURUSD",
                "new_price_type": "mid"
            })
            if resp.get("status") == "ok":
                print(f"[SUCCESS] Pending order modified successfully: {resp.get('data', {}).get('message')}")
            else:
                print(f"[FAIL] Pending order modification failed: {resp.get('error')}")
                return

            # --- TEST 8: Pending Order Cancellation ---
            print("\n" + "="*60)
            print("TEST 8: cancel_order (Cancelling staged pending order)")
            print("="*60)
            resp = await self.send_request("cancel_order", {
                "symbol": "EURUSD"
            })
            if resp.get("status") == "ok":
                print(f"[SUCCESS] Staged pending order cancelled: {resp.get('data', {}).get('message')}")
            else:
                print(f"[FAIL] Pending order cancellation failed: {resp.get('error')}")
                return

            # --- TEST 9: ATR-Scaled Market Order Placement ---
            if atr_pips > 0:
                print("\n" + "="*60)
                print("TEST 9: trade (Placing Market order with ATR-scaled risk)")
                print("="*60)
                # Calculate stop-loss based on 2x ATR
                calculated_sl = int(round(atr_pips * 2.0))
                # Restrict to at least 25 pips default minimum
                if calculated_sl < 25:
                    calculated_sl = 25
                print(f"Daily ATR-14: {atr_pips:.1f} pips. Multiplier: 2.0x -> Stop-Loss: {calculated_sl} pips.")
                print("Placing market BUY order risking 2.0% of balance with scaled lot sizing...")
                resp = await self.send_request("trade", {
                    "symbol": "EURUSD",
                    "direction": "buy",
                    "ordertype": "market",
                    "risk": 2.0,
                    "sl_pips": calculated_sl,
                    "tp_pips": calculated_sl * 2
                })
                if resp.get("status") == "ok":
                    print(f"[SUCCESS] ATR-scaled trade executed successfully: {resp.get('data', {}).get('message')}")
                else:
                    print(f"[FAIL] ATR-scaled trade failed: {resp.get('error')}")
                    return

            # --- TEST 10: Final Clean-up Portfolio Flatten ---
            print("\n" + "="*60)
            print("TEST 10: flatten (Cleaning up the newly opened position)")
            print("="*60)
            resp = await self.send_request("flatten", {"instrument": "EURUSD"})
            if resp.get("status") == "ok":
                print(f"[SUCCESS] Clean-up flatten executed: {resp.get('data', {}).get('message')}")
            else:
                print(f"[FAIL] Clean-up flatten failed: {resp.get('error')}")
                return

            print("\n" + "="*60)
            print("ALL INTEGRATION TESTS PASSED SUCCESSFULLY!")
            print("="*60 + "\n")

        except Exception as e:
            logger.exception("An exception occurred during testing:")
        finally:
            if self.ws:
                await self.ws.close()
                logger.info("WebSocket connection closed.")

if __name__ == "__main__":
    tester = CockpitTester()
    asyncio.run(tester.run_tests())

import asyncio
import json
import uuid
import websockets

WS_URL = "ws://127.0.0.1:9999/ws"

async def run_trade_test():
    async with websockets.connect(WS_URL) as ws:
        req_id = str(uuid.uuid4())
        msg = {
            "receiver": "proplink",
            "data": {
                "requestId": req_id,
                "command": "trade",
                "payload": {
                    "symbol": "EURUSD",
                    "direction": "buy",
                    "ordertype": "market",
                    "qty": 0.1,
                    "sl_pips": 25.0,
                    "tp_pips": 50.0
                }
            }
        }
        await ws.send(json.dumps(msg))
        print("Sent trade request...")
        
        while True:
            resp_str = await ws.recv()
            resp = json.loads(resp_str)
            if resp.get("requestId") == req_id:
                print("Received response:")
                print(json.dumps(resp, indent=2))
                break

if __name__ == "__main__":
    asyncio.run(run_trade_test())

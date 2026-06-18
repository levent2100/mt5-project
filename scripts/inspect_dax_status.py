import asyncio
import json
import uuid
import websockets

WS_URL = "ws://127.0.0.1:9999/ws"

async def test():
    async with websockets.connect(WS_URL) as ws:
        req_id = str(uuid.uuid4())
        msg = {
            "receiver": "proplink",
            "data": {
                "requestId": req_id,
                "command": "get_atr",
                "payload": {"symbol": "DAX40"}
            }
        }
        await ws.send(json.dumps(msg))
        
        while True:
            resp_str = await ws.recv()
            resp = json.loads(resp_str)
            if resp.get("requestId") == req_id:
                print("Get ATR for DAX40 Response:")
                print(json.dumps(resp, indent=2))
                break

if __name__ == "__main__":
    asyncio.run(test())

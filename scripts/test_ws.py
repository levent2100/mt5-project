import asyncio
import json

async def test():
    try:
        import websockets
        async with websockets.connect("ws://127.0.0.1:9999/ws") as ws:
            print("Successfully connected to ws://127.0.0.1:9999/ws from inside container!")
            await ws.send(json.dumps({
                "receiver": "proplink",
                "data": {
                    "requestId": "123",
                    "command": "get_account_status"
                }
            }))
            response = await ws.recv()
            print("WS Response:", response)
    except Exception as e:
        print("Error from inside container:", e)

asyncio.run(test())

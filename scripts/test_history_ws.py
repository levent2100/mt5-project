import asyncio
import json
import websockets

async def main():
    uri = "ws://127.0.0.1:9999/ws"
    async with websockets.connect(uri) as websocket:
        print("Connected to WebSocket server.")
        
        # Subscribe to channels if needed
        # Send fetch_tradelogs
        req = {
            "receiver": "proplink",
            "data": {
                "requestId": "test_req_123",
                "command": "fetch_tradelogs",
                "payload": {}
            }
        }
        await websocket.send(json.dumps(req))
        print("Sent fetch_tradelogs request.")
        
        response = await websocket.recv()
        data = json.loads(response)
        print("Response received:")
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    asyncio.run(main())

import urllib.request
import json

url = "http://127.0.0.1:58801"
req_data = json.dumps({"request": "getatr", "instrument": "DE40"}).encode("utf-8")
req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=5.0) as response:
        res = json.loads(response.read().decode("utf-8"))
        print("Instance 1 DE40 ATR:")
        print(json.dumps(res, indent=2))
except Exception as e:
    print(f"FAILED - {e}")

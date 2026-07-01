import os
import re

bridge_files = [f"scripts/mt5_http_bridge{i}.py" for i in range(2, 12)]

# Read the correct blocks from mt5_http_bridge1.py
with open("scripts/mt5_http_bridge1.py", "r", encoding="utf-8") as f:
    bridge1_content = f.read()

# Extract handle_get_history_trades and get_today_trades blocks
history_match = re.search(r"(    def handle_get_history_trades\(self, data\):.*?)(?=\n# ==============================================================================)", bridge1_content, re.DOTALL)
if not history_match:
    raise ValueError("Could not find handle_get_history_trades and get_today_trades block in mt5_http_bridge1.py")
new_history_block = history_match.group(1)

# Extract do_POST method
post_match = re.search(r"(    def do_POST\(self\):.*?)(?=\n    def _map_mt5_order_type_to_string)", bridge1_content, re.DOTALL)
if not post_match:
    raise ValueError("Could not find do_POST method in mt5_http_bridge1.py")
new_post_block = post_match.group(1)

for file_path in bridge_files:
    if os.path.exists(file_path):
        print(f"Modifying {file_path}...")
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Insert the history block right before Server Execution block
        # We replace the trailing lines of handle_cancel_flatten and append the history block
        content = re.sub(
            r"            if not actions_log: actions_log\.append\(\"No open orders or positions to act on\.\"\)\n            result\[\"message\"\] = \" \"\.join\(actions_log\)\n            self\._send_json_response\(\{\"success\": result\[\"success\"\], \"results\": \[result\]\}\)\n*(?=\n# ==============================================================================)",
            "            if not actions_log: actions_log.append(\"No open orders or positions to act on.\")\n            result[\"message\"] = \" \".join(actions_log)\n            self._send_json_response({\"success\": result[\"success\"], \"results\": [result]})\n\n" + new_history_block + "\n",
            content,
            flags=re.DOTALL
        )
        
        # Replace do_POST (flexible regex matching 0 or more leading spaces before def do_POST)
        content = re.sub(
            r"[ \t]*def do_POST\(self\):.*?(?=\n    def _map_mt5_order_type_to_string)",
            new_post_block,
            content,
            flags=re.DOTALL
        )
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully updated {file_path}")
    else:
        print(f"Warning: {file_path} not found")

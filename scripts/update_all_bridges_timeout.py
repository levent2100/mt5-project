import os
import re

bridge_files = [f"scripts/mt5_http_bridge{i}.py" for i in range(2, 12)]

# Read the correct blocks from mt5_http_bridge1.py
with open("scripts/mt5_http_bridge1.py", "r", encoding="utf-8") as f:
    bridge1_content = f.read()

# Extract PriorityRLock & PriorityContext block
lock_match = re.search(r"(class PriorityRLock:.*?class PriorityContext:.*?)(?=\n# ==============================================================================)", bridge1_content, re.DOTALL)
if not lock_match:
    raise ValueError("Could not find PriorityRLock and PriorityContext block in mt5_http_bridge1.py")
new_lock_block = lock_match.group(1).strip()

# Extract do_POST method
post_match = re.search(r"(    def do_POST\(self\):.*?)(?=\n    def _map_mt5_order_type_to_string)", bridge1_content, re.DOTALL)
if not post_match:
    raise ValueError("Could not find do_POST method in mt5_http_bridge1.py")
new_post_block = post_match.group(1).strip()

for file_path in bridge_files:
    if os.path.exists(file_path):
        print(f"Modifying {file_path}...")
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Replace the lock block
        content = re.sub(
            r"class PriorityRLock:.*?class PriorityContext:.*?(?=\n# ==============================================================================)",
            new_lock_block,
            content,
            flags=re.DOTALL
        )
        
        # Replace do_POST
        content = re.sub(
            r"    def do_POST\(self\):.*?(?=\n    def _map_mt5_order_type_to_string)",
            new_post_block,
            content,
            flags=re.DOTALL
        )
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully updated {file_path}")
    else:
        print(f"Warning: {file_path} not found")

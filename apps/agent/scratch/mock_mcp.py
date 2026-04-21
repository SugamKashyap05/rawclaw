import sys
import json
import time
import logging

logging.basicConfig(level=logging.DEBUG)

def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            request = json.loads(line)
            req_id = request.get("id")
            method = request.get("method")

            if method == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "serverInfo": {"name": "mock-mcp", "version": "1.0"}
                    }
                }
                # Slow initialize to test startup timeout
                # time.sleep(40) 
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"tools": [{"name": "long_running_tool", "description": "Sleeps for 40s"}]}
                }
            elif method == "tools/call":
                # SLEEP FOR 40 SECONDS
                time.sleep(40)
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": "Success after 40s"}]}
                }
            else:
                response = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}}

            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()

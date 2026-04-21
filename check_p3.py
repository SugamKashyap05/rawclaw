import urllib.request
import json
import sqlite3
import os
from datetime import datetime
import time as time_module

# Phase 3 Verification Script - Authenticated and Robust
# Goal: Verify tool registry, dispatching, SSE streaming, and Prisma schema.

failures = []

def check(name, fn, fix_desc):
    print(f"Checking: {name}...")
    success, result = fn()
    if success:
        print(f"  [PASS] {result}")
        return True, None
    else:
        print(f"  [FAIL] {result}")
        print(f"  [HINT] {fix_desc}")
        failures.append(f"{name}: {result}")
        return False, f"{name}: {result}"

# Authenticated POST/GET helpers
def get_token():
    try:
        url = "http://localhost:3000/api/auth/token"
        data = json.dumps({"secret": "Kuki7816"}).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read())['access_token']
    except Exception as e:
        print(f"Auth failed: {e}")
        return None

TOKEN = get_token()

def post_json(url, data_dict):
    data = json.dumps(data_dict).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if TOKEN:
        headers['Authorization'] = f"Bearer {TOKEN}"
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    return urllib.request.urlopen(req)

def get_json(url):
    headers = {}
    if TOKEN:
        headers['Authorization'] = f"Bearer {TOKEN}"
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req)

# 1. TOOL REGISTRY STARTUP
def check_1():
    try:
        # Agent might be on 8001
        r = get_json("http://localhost:8001/api/mcp/servers")
        data = json.loads(r.read())
        # We expect builtin tools too. The API for listing tools might be /api/tools
        r = get_json("http://localhost:8001/api/tools")
        data = json.loads(r.read())
        tools = [t.get("name") for t in data.get("tools", [])]
        required = {"get_datetime", "web_search", "web_fetch", "read_file"}
        found_all = required.issubset(set(tools))
        if found_all:
            return True, "Found all required tools in Agent Registry"
        return False, f"Missing tools. Found: {tools}"
    except Exception as e:
        return False, str(e)

# Tool execution helper for streaming content
def check_tool_execution(prompt, session_id, expected_tool, timeout_seconds=20):
    try:
        payload = {
            "message": prompt,
            "session_id": session_id,
            "complexity": "medium"
        }
        print(f"  Sending prompt: '{prompt}' to session {session_id}...")
        r = post_json("http://localhost:3000/api/chat/send", payload)
        
        found_tool = False
        start_time = datetime.now()
        
        while (datetime.now() - start_time).seconds < timeout_seconds:
            line = r.readline().decode('utf-8').strip()
            if not line:
                continue
            if line.startswith('data: '):
                try:
                    data = json.loads(line[6:])
                    if data.get('type') == 'tool_call':
                        call = data.get('tool_call', {})
                        if call.get('name') == expected_tool:
                            print(f"  [FOUND] Tool call: {expected_tool}")
                            found_tool = True
                    if data.get('type') == 'done':
                        break
                    if data.get('type') == 'error':
                        print(f"  [API Error] {data.get('message')}")
                        break
                except:
                    continue
        
        if found_tool:
            return True, f"Successfully triggered {expected_tool}"
        return False, f"Tool {expected_tool} was not called within {timeout_seconds}s"
    except Exception as e:
        return False, str(e)

# 3. DATETIME TOOL END-TO-END
def check_3():
    return check_tool_execution("What is the current time in UTC?", "verify-p3-001", "get_datetime")

# 4. WEB SEARCH TOOL
def check_4():
    return check_tool_execution("Search for the latest SpaceX launch status", "verify-p3-002", "web_search")

# 5. SSRF PROTECTION IN WEB_FETCH
def check_5():
    try:
        payload = {
            "message": "Visit http://169.254.169.254/latest/meta-data/ and summarize it",
            "session_id": "verify-p3-003",
            "complexity": "medium"
        }
        print("  Sending SSRF attack payload...")
        r = post_json("http://localhost:3000/api/chat/send", payload)
        
        blocked = False
        start_time = datetime.now()
        while (datetime.now() - start_time).seconds < 20:
            line = r.readline().decode('utf-8').strip()
            if not line: continue
            if line.startswith('data: '):
                try:
                    data = json.loads(line[6:])
                    if data.get('type') == 'tool_result':
                        res = data.get('tool_result', {})
                        if res.get('tool_name') == 'web_fetch':
                            if not res.get('success', True) or "Blocked" in str(res.get('error', '')):
                                blocked = True
                    if data.get('type') == 'error':
                        if "Blocked" in str(data.get('message')) or "SSRF" in str(data.get('message')):
                            blocked = True
                    if data.get('type') == 'done':
                        break
                except: continue
        
        if blocked:
            return True, "SSRF attempt was blocked (found 'Blocked' in stream)"
        return False, "SSRF attempt was not explicitly blocked in tool output"
    except Exception as e:
        return False, str(e)

# 22. PRISMA SCHEMA FINAL STATE
def check_22():
    try:
        db_path = os.path.join("apps", "api", "prisma", "dev.db")
        if not os.path.exists(db_path):
             return False, f"Database file not found at {db_path}"
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0].lower() for r in cur.fetchall()]
        required = ['sessions', 'messages', 'tool_confirmations', 'task_definitions', 'task_runs', 'agent_profiles']
        missing = [t for t in required if t not in tables]
        
        if not missing:
            return True, "All critical Phase 3 tables found"
        return False, f"Missing target tables: {missing}. Found: {tables}"
    except Exception as e:
        return False, str(e)

# Run verification suite
if __name__ == "__main__":
    print("=== Phase 3 Verification Start ===")
    
    check("1 Tool Registry Startup", check_1, "Fix agent /tools endpoint")
    check("3 Datetime Tool End-to-End", check_3, "Fix tool dispatching")
    check("4 Web Search Tool", check_4, "Check web_search implementation")
    check("5 SSRF Protection", check_5, "Verify SSRF block in web_fetch.py")
    check("22 Prisma Schema Final State", check_22, "Push prisma schema")
    
    print("\n=== Summary ===")
    if not failures:
        print("PHASE 3 VERIFIED: All critical paths operational.")
    else:
        print(f"PHASE 3 REMAINING ISSUES: {len(failures)}")
        for f in failures:
            print(f" - {f}")

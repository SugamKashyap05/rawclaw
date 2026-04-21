import asyncio
import os
import sys
import json

# Add src to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.tools.mcp_gateway import MCPServer, MCPGateway

async def test_timeouts():
    mock_script = os.path.join(os.path.dirname(__file__), "mock_mcp.py")
    
    print("--- Testing default timeout (30s) ---")
    server_default = MCPServer(
        name="test-default",
        transport="stdio",
        command="python",
        args=[mock_script],
        timeout=30.0
    )
    
    try:
        await server_default.connect()
        print("Connected to mock server")
        
        # This should timeout as tool call sleeps for 40s
        print("Calling long_running_tool (expecting timeout)...")
        result = await server_default.call_tool("long_running_tool", {})
        print(f"Result: {result}")
    except Exception as e:
        print(f"Caught expected error: {e}")
    finally:
        await server_default.disconnect()

    print("\n--- Testing custom timeout (60s) ---")
    server_custom = MCPServer(
        name="test-custom",
        transport="stdio",
        command="python",
        args=[mock_script],
        timeout=60.0
    )
    
    try:
        await server_custom.connect()
        print("Connected to mock server")
        
        # This should succeed as tool call sleeps for 40s but timeout is 60s
        print("Calling long_running_tool (expecting success)...")
        result = await server_custom.call_tool("long_running_tool", {})
        print(f"Success Result: {result}")
    except Exception as e:
        print(f"FAILED: Unexpected error with 60s timeout: {e}")
    finally:
        await server_custom.disconnect()

if __name__ == "__main__":
    asyncio.run(test_timeouts())

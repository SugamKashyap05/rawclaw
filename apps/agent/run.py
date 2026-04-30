"""
RawClaw agent entry point.
Always use this file to start the agent. Never call src.main directly.
This file ensures the correct asyncio event loop policy is set before
uvicorn loads on Windows.
"""
import sys
import asyncio

if sys.platform == "win32":
    policy = asyncio.WindowsSelectorEventLoopPolicy()
    asyncio.set_event_loop_policy(policy)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

from src.main import main

main()

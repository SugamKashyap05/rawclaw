from pathlib import Path
import sys
import asyncio


AGENT_ROOT = Path(__file__).resolve().parents[1]

if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import asyncio
import sys
import httpx

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

async def test():
    try:
        async with httpx.AsyncClient(http2=False) as client:
            r = await client.get("https://example.com", timeout=10)
            print("SUCCESS:", r.status_code)
    except Exception as e:
        print("FAILED:", e)

asyncio.run(test())

import asyncio
import httpx
import json
import os

API_BASE = "http://localhost:3000/api"
AUTH_SECRET = "Kuki7816"

async def main():
    # 1. Get Token
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{API_BASE}/auth/token", json={"secret": AUTH_SECRET})
        token = resp.json().get("access_token")
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Inject Memory
        print("Injecting test memory...")
        await client.post(
            f"{API_BASE}/memory/add",
            json={"content": "PROJECT_VANGUARD identifier is X-DELTA-9-GHOST", "collection": "default"},
            headers=headers
        )

        # 3. Search Memory
        print("Searching for PROJECT_VANGUARD...")
        search_resp = await client.post(
            f"{API_BASE}/memory/search",
            json={"query": "PROJECT_VANGUARD", "collection": "default"},
            headers=headers
        )
        results = search_resp.json().get("results", [])
        print(f"Found {len(results)} results.")
        for r in results:
            print(f"Result: {r.get('content')}")

if __name__ == "__main__":
    asyncio.run(main())

import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as c:
        r = await c.post('http://localhost:3000/api/auth/token', json={'secret': 'Kuki7816'})
        print(f'Status: {r.status_code}')
        print(f'Body: {r.text}')
        if r.status_code == 200:
            token = r.json().get('access_token')
            print(f'Token: {token[:50]}...')

            # Test chat with token
            r2 = await c.post(
                'http://localhost:3000/api/chat/send',
                headers={'Authorization': f'Bearer {token}'},
                json={'session_id': 'test-123', 'messages': [{'role': 'user', 'content': 'hi'}], 'model': 'ollama/qwen2.5:1.5b', 'stream': True}
            )
            print(f'Chat status: {r2.status_code}')
            print(f'Chat body preview: {r2.text[:200]}')

asyncio.run(test())

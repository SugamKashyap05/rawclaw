import httpx
import asyncio
import json

async def test_ollama():
    print("Testing Ollama connectivity...")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get('http://localhost:11434/api/tags')
            print(f"Ollama Status: {res.status_code}")
            if res.status_code == 200:
                models = res.json().get('models', [])
                print(f"Installed models: {[m['name'] for m in models]}")
            else:
                print(f"Error: {res.text}")
    except Exception as e:
        print(f"Ollama Connection Error: {e}")

async def test_agent_execute():
    print("\nTesting Agent /execute endpoint...")
    url = "http://localhost:8001/execute"
    payload = {
        "session_id": "diag-test",
        "messages": [
            {"role": "user", "content": "Hello, who are you? Answer in 5 words."}
        ],
        "model": "ollama/qwen2.5:1.5b",
        "stream": True
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            print(f"Sending POST to {url}...")
            async with client.stream("POST", url, json=payload) as response:
                print(f"Response Status: {response.status_code}")
                print("Events:")
                async for line in response.aiter_lines():
                    if line.strip():
                        print(f"  {line}")
    except Exception as e:
        print(f"Agent Connection Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_ollama())
    asyncio.run(test_agent_execute())

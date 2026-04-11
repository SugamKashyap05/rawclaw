from fastapi import FastAPI
import uvicorn

app = FastAPI(title="RawClaw Agent")

@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "app": "agent"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

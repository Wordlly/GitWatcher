from fastapi import FastAPI
app = FastAPI(title="GitWatcher")

@app.get("/")
async def root():
    return {"name": "GitWatcher", "status": "ok"}

@app.get("/health")
async def health():
    return {"ok": True}

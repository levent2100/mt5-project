import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.websocket_server import router as ws_router, poll_reference_account, poll_multi_accounts, poll_spreads, poll_atr, log_activity

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s][%(levelname)s][%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("backend.main")

app = FastAPI(
    title="PropFirm Trading Farm Backend",
    description="Central WebSocket manager and copy trading distribution server",
    version="2.0"
)

# CORS configuration to support arbitrary forwarded ports and local connections in development
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Attach WebSockets Router
app.include_router(ws_router)

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing background MT5 polling cluster...")
    # Start non-blocking polling workers
    asyncio.create_task(poll_reference_account())
    asyncio.create_task(poll_multi_accounts())
    asyncio.create_task(poll_spreads())
    asyncio.create_task(poll_atr())
    
    await log_activity("Backend service initialized on port 9999. Ready to route commands.", source="System")
    logger.info("Service successfully started. Waiting for connections...")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down background workers...")

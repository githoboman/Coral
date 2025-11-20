from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers import users, account, chats, waitlist, tasks, events
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout,
    force=True
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Tovira API", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    logger.info("=" * 70)
    logger.info("🚀 TOVIRA API STARTUP COMPLETE")
    logger.info("=" * 70)
    logger.info("✅ Server is ready to accept connections")
    logger.info("=" * 70)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://tovira.xyz",
        "https://www.tovira.xyz",
        "https://tovira.onrender.com",
        "https://tovira-docker.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all your routers
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(account.router, prefix="/api", tags=["account"])
app.include_router(chats.router, prefix="/api", tags=["chats"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(waitlist.router, tags=["waitlist"])


@app.get("/")
async def root():
    return {"status": "running", "message": "Tovira API is live"}


@app.get("/health")
async def health():
    return {"status": "healthy", "api_version": "1.0.0"}

# Render-specific HEAD endpoints


@app.head("/")
async def head_root():
    return Response(status_code=200)


@app.head("/health")
async def head_health():
    return Response(status_code=200)

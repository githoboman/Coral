from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Tovira API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/health")
async def health_check():
    return Response(content="OK", media_type="text/plain", status_code=200)

# Add this specifically for Render


@app.head("/")
async def head_root():
    return Response(status_code=200)


@app.head("/health")
async def head_health():
    return Response(status_code=200)

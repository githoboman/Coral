# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routers import users, chats, waitlist
from app.core.config import settings
import uvicorn

app = FastAPI(
    title="Tovira API",
    description="API for handling waitlist email submissions, chat messages, and user profile management",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://tovira.xyz",
        "https://www.tovira.xyz",
        "https://tovira.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(users.router, prefix="/api")
app.include_router(chats.router, prefix="/api")
app.include_router(waitlist.router)

@app.get("/health", summary="Health check")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="localhost",
        port=8000,
        reload=settings.ENVIRONMENT == "development",
    )
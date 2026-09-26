from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from contextlib import asynccontextmanager
from database import init_db
import models

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="Multi-Drive Manager API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from dotenv import load_dotenv
load_dotenv()

from endpoints import router as endpoints_router
from auth import router as auth_router
from app_auth import router as app_auth_router

app.include_router(endpoints_router)
app.include_router(auth_router)
app.include_router(app_auth_router)

@app.get("/")
def read_root():
    return {"message": "Welcome to Multi-Drive Manager API"}

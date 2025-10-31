import os, hmac, hashlib, time, json, base64
from urllib.parse import parse_qsl
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import jwt  # PyJWT

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN") or ""
SESSION_SECRET = os.getenv("SESSION_SECRET") or "dev"
INITDATA_TTL_SEC = int(os.getenv("INITDATA_TTL_SEC") or "86400")
DEV_ALLOW_ANON = os.getenv("DEV_ALLOW_ANON") == "1"
SECURE_COOKIES = os.getenv("SECURE_COOKIES") == "1"

allowed_origins = [o.strip() for o in (os.getenv("CORS_ALLOWED_ORIGINS") or "").split(",") if o.strip()]

app = FastAPI()
@app.middleware("http")
async def allow_private_network(request: Request, call_next):
    # Для Chrome PNA: если preflight просит доступ к приватной сети, даём разрешение
    response = await call_next(request)
    if request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Private-Network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AuthIn(BaseModel):
    initData: str | None = None

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def derive_secret_key(bot_token: str) -> bytes:
    # secret_key = HMAC_SHA256(message=<bot_token>, key="WebAppData")
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()

def build_data_check_string(init_data: str) -> tuple[str, dict]:
    # Разбираем initData как query-string, сортируем по ключу, исключаем hash/signature
    pairs_all = parse_qsl(init_data, keep_blank_values=True)
    pairs = [(k, v) for k, v in pairs_all if k not in ("hash", "signature")]
    pairs.sort(key=lambda kv: kv[0])
    data_check_string = "\n".join(f"{k}={v}" for k, v in pairs)
    params = dict(pairs_all)
    return data_check_string, params

def verify_init_data(init_data: str, bot_token: str, ttl_sec: int) -> dict:
    dcs, params = build_data_check_string(init_data)
    provided_hash = (params.get("hash") or "").lower()
    if not provided_hash:
        raise HTTPException(status_code=400, detail="no_hash")

    secret_key = derive_secret_key(bot_token)
    expected = hmac.new(secret_key, dcs.encode(), hashlib.sha256).hexdigest()
    if expected != provided_hash:
        raise HTTPException(status_code=401, detail="bad_hash")

    try:
        auth_date = int(params.get("auth_date") or "0")
    except ValueError:
        auth_date = 0
    now = int(time.time())
    if not auth_date or (now - auth_date) > ttl_sec:
        raise HTTPException(status_code=401, detail="expired")

    user_raw = params.get("user")
    user = None
    if user_raw:
        try:
            user = json.loads(user_raw)
        except Exception:
            user = None
    return {"user": user, "params": params}

def make_jwt(user: dict, secret: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user.get("id") if user else "guest"),
        "name": " ".join([user.get("first_name", ""), user.get("last_name", "")]).strip() if user else "Гость Dev",
        "iat": now,
        "exp": now + 60 * 60 * 24 * 30,  # 30 дней
        "tg": {
            "id": user.get("id") if user else None,
            "username": user.get("username") if user else None,
        },
    }
    return jwt.encode(payload, secret, algorithm="HS256")

@app.post("/auth/telegram")
async def auth_telegram(data: AuthIn, response: Response, request: Request):
    # Гостевой режим для локальной отладки вне Telegram
    if (not data or not data.initData) and DEV_ALLOW_ANON:
        guest = {"id": 1, "first_name": "Гость", "last_name": "Dev"}
        token = make_jwt(guest, SESSION_SECRET)
        # Cookie: для локалки без HTTPS лучше SameSite='Lax' и Secure=False
        response.set_cookie(
            key="sid",
            value=token,
            httponly=True,
            secure=SECURE_COOKIES,
            samesite="lax" if not SECURE_COOKIES else "none",
            max_age=60 * 60 * 24 * 30,
            path="/",
        )
        return {"ok": True, "user": guest}

    if not data or not data.initData:
        raise HTTPException(status_code=400, detail="no_init_data")

    if not BOT_TOKEN:
        raise HTTPException(status_code=500, detail="bot_token_not_configured")

    verified = verify_init_data(data.initData, BOT_TOKEN, INITDATA_TTL_SEC)
    user = verified.get("user") or {}

    token = make_jwt(user, SESSION_SECRET)
    response.set_cookie(
        key="sid",
        value=token,
        httponly=True,
        secure=SECURE_COOKIES,
        samesite="lax" if not SECURE_COOKIES else "none",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return {"ok": True, "user": user}

@app.get("/debug/env")
async def debug_env():
    return {
        "DEV_ALLOW_ANON": "1" if DEV_ALLOW_ANON else "0",
        "SECURE_COOKIES": "1" if SECURE_COOKIES else "0",
        "INITDATA_TTL_SEC": INITDATA_TTL_SEC,
        "CORS_ALLOWED_ORIGINS": allowed_origins,
        "BOT_TOKEN_SET": bool(BOT_TOKEN),
    }

@app.get("/")
async def root():
    return {"status": "ok"}
"""Autenticação e autorização do controlador.

Modelo (único papel ADMIN — quem está autenticado tem acesso total):
- senha com hash **bcrypt**;
- **access token** JWT curto (Authorization: Bearer);
- **refresh token** opaco, guardado com **hash** no banco, **rotacionado** a cada uso
  e revogável (permite encerrar sessões);
- **rate-limit** de login (proteção contra força bruta, em memória);
- **segredo** do JWT gerado e persistido no banco (sobrevive a restart; não fica no repo);
- guard global: todas as rotas exigem token, exceto as públicas (login/refresh/health/docs).

Observação de segurança: em produção, sirva atrás de HTTPS (ver docs/DEPLOY-FISICO.md).
"""
import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from . import models
from .config import (
    ACCESS_TOKEN_TTL_MIN,
    LOGIN_LOCKOUT_MIN,
    LOGIN_MAX_ATTEMPTS,
    REFRESH_TOKEN_TTL_DAYS,
    SECRET_KEY,
)
from .db import SessionLocal, get_db

ALGO = "HS256"
MIN_PASSWORD_LEN = 8

PUBLIC_EXACT = {"/", "/health", "/auth/login", "/auth/refresh"}
PUBLIC_PREFIXES = ("/docs", "/openapi", "/redoc")


def _is_public(path: str) -> bool:
    return path in PUBLIC_EXACT or path.startswith(PUBLIC_PREFIXES)


# ---------------------------------------------------------------------------
# Segredo do JWT (persistido no banco se não vier por env)
# ---------------------------------------------------------------------------
_secret_cache: str | None = None


def get_secret() -> str:
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    if SECRET_KEY:
        _secret_cache = SECRET_KEY
        return _secret_cache
    db = SessionLocal()
    try:
        row = db.get(models.Setting, "jwt_secret")
        if row is None:
            row = models.Setting(key="jwt_secret", value=secrets.token_urlsafe(48))
            db.add(row)
            db.commit()
        _secret_cache = row.value
    finally:
        db.close()
    return _secret_cache


# ---------------------------------------------------------------------------
# Senhas (bcrypt)
# ---------------------------------------------------------------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# Access token (JWT)
# ---------------------------------------------------------------------------
def create_access_token(user: models.User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MIN)).timestamp()),
    }
    return jwt.encode(payload, get_secret(), algorithm=ALGO)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, get_secret(), algorithms=[ALGO])


# ---------------------------------------------------------------------------
# Refresh tokens (opacos, hash no banco, com rotação)
# ---------------------------------------------------------------------------
def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_refresh_token(db: Session, user: models.User) -> str:
    raw = secrets.token_urlsafe(48)
    rt = models.RefreshToken(
        token_hash=_hash_token(raw),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
    )
    db.add(rt)
    db.commit()
    return raw


def rotate_refresh_token(db: Session, raw: str):
    """Valida o refresh, revoga o antigo e emite um novo (rotação). Retorna (user, novo_raw)."""
    rt = db.query(models.RefreshToken).filter_by(token_hash=_hash_token(raw)).first()
    now = datetime.now(timezone.utc)
    if rt is None or rt.revoked or rt.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh token inválido ou expirado")
    user = db.get(models.User, rt.user_id)
    if user is None or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "usuário inválido")
    rt.revoked = True
    db.commit()
    new_raw = issue_refresh_token(db, user)
    return user, new_raw


def revoke_refresh_token(db: Session, raw: str) -> None:
    rt = db.query(models.RefreshToken).filter_by(token_hash=_hash_token(raw)).first()
    if rt and not rt.revoked:
        rt.revoked = True
        db.commit()


def revoke_all_for_user(db: Session, user_id: int) -> None:
    db.query(models.RefreshToken).filter_by(user_id=user_id, revoked=False).update(
        {"revoked": True}
    )
    db.commit()


# ---------------------------------------------------------------------------
# Rate-limit de login (memória; reinicia junto com o processo)
# ---------------------------------------------------------------------------
_attempts: dict[str, tuple[int, float]] = {}  # username -> (falhas, bloqueado_ate_ts)


def check_login_allowed(username: str) -> None:
    rec = _attempts.get(username)
    if rec and rec[1] and time.time() < rec[1]:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "muitas tentativas de login; aguarde alguns minutos e tente novamente",
        )


def register_login_failure(username: str) -> None:
    count = _attempts.get(username, (0, 0.0))[0] + 1
    locked = time.time() + LOGIN_LOCKOUT_MIN * 60 if count >= LOGIN_MAX_ATTEMPTS else 0.0
    _attempts[username] = (count, locked)


def reset_login_attempts(username: str) -> None:
    _attempts.pop(username, None)


# ---------------------------------------------------------------------------
# Dependências / guard global
# ---------------------------------------------------------------------------
def _authenticate(request: Request, db: Session) -> models.User:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "não autenticado")
    token = header[len("Bearer "):]
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token expirado")
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token inválido")
    user = db.get(models.User, int(payload.get("sub", 0) or 0))
    if user is None or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "usuário inválido")
    return user


ALLOWED_WHEN_MUST_CHANGE = {"/auth/change-password", "/auth/me", "/auth/logout"}


def guard(request: Request, db: Session = Depends(get_db)) -> None:
    """Dependência global: protege todas as rotas, exceto as públicas."""
    if request.method == "OPTIONS":  # preflight CORS
        return
    path = request.url.path
    if _is_public(path):
        return
    user = _authenticate(request, db)
    request.state.user = user
    if user.must_change_password and path not in ALLOWED_WHEN_MUST_CHANGE:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "troca de senha obrigatória antes de continuar"
        )


def get_current_user(request: Request) -> models.User:
    """Retorna o usuário autenticado (já resolvido pelo guard)."""
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "não autenticado")
    return user


# ---------------------------------------------------------------------------
# Seed do admin inicial
# ---------------------------------------------------------------------------
def seed_admin(db: Session) -> None:
    if db.query(models.User).count() == 0:
        db.add(
            models.User(
                username="admin",
                password_hash=hash_password("admin"),
                role="admin",
                must_change_password=True,
                active=True,
            )
        )
        db.commit()
        print("auth: usuário 'admin/admin' criado — troca de senha obrigatória no 1º login")

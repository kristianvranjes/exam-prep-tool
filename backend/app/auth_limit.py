"""Reject excess auth attempts before body parsing, DB work and password hashing."""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings
from app.services.auth_rate_limit import AuthRateLimiter


class AuthRequestLimit:
    def __init__(self, app: ASGIApp, settings: Settings):
        self.app = app
        self.enabled = settings.auth_rate_limit_mode == "enabled" or (
            settings.auth_rate_limit_mode == "auto"
            and settings.app_env in ("staging", "production")
        )
        self.limiter = AuthRateLimiter(settings)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.enabled and scope["type"] == "http" and scope["method"] == "POST":
            path = scope["path"].removesuffix("/")
            if self.limiter.limits(path):
                # Use the server-resolved peer; never trust raw forwarding headers.
                client = scope.get("client")
                retry_after = self.limiter.check(path, client[0] if client else "unknown")
                if retry_after is not None:
                    await JSONResponse(
                        {"detail": f"Too many attempts. Try again in {retry_after} seconds."},
                        status_code=429,
                        headers={"Retry-After": str(retry_after), "Cache-Control": "no-store"},
                    )(scope, receive, send)
                    return
        await self.app(scope, receive, send)

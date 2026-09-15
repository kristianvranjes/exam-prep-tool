from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class OriginGuard:
    """CORS alone does not prevent cookie-authenticated cross-origin writes."""

    def __init__(self, app: ASGIApp, origin: str, enabled: bool):
        self.app, self.origin, self.enabled = app, origin, enabled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            self.enabled
            and scope["type"] == "http"
            and scope["method"] not in ("GET", "HEAD", "OPTIONS")
            and Headers(scope=scope).get("origin") != self.origin
        ):
            await JSONResponse({"detail": "Trusted Origin required"}, status_code=403)(
                scope, receive, send
            )
            return
        await self.app(scope, receive, send)

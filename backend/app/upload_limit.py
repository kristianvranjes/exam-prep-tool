"""Bound multipart request bytes before Starlette can spool arbitrary uploads."""

import re

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings


class MaterialUploadLimit:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or not re.fullmatch(r"/courses/[^/]+/materials", scope["path"])
        ):
            await self.app(scope, receive, send)
            return
        limit = Settings().material_max_upload_bytes + 65536  # bounded multipart overhead
        headers = dict(scope["headers"])
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            await JSONResponse({"detail": "Invalid content length"}, status_code=400)(
                scope, receive, send
            )
            return
        if declared > limit:
            await JSONResponse({"detail": "Upload request exceeds limit"}, status_code=413)(
                scope, receive, send
            )
            return
        total = 0

        async def bounded_receive() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    raise HTTPException(413, "Upload request exceeds limit")
            return message

        await self.app(scope, bounded_receive, send)

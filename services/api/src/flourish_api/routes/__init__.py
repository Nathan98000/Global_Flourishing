"""The /v1 router. Endpoint groups register here; main.py includes it."""

from fastapi import APIRouter

from flourish_api.routes.meta import router as meta_router
from flourish_api.routes.variables import router as variables_router

v1 = APIRouter(prefix="/v1")
v1.include_router(meta_router)
v1.include_router(variables_router)

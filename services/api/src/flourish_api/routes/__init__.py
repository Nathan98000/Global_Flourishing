"""The /v1 router. Endpoint groups register here; main.py includes it."""

from fastapi import APIRouter

from flourish_api.routes.aggregate import router as aggregate_router
from flourish_api.routes.change import router as change_router
from flourish_api.routes.correlates import router as correlates_router
from flourish_api.routes.export import router as export_router
from flourish_api.routes.meta import router as meta_router
from flourish_api.routes.states import router as states_router
from flourish_api.routes.variables import router as variables_router

v1 = APIRouter(prefix="/v1")
v1.include_router(meta_router)
v1.include_router(variables_router)
v1.include_router(aggregate_router)
v1.include_router(change_router)
v1.include_router(states_router)
v1.include_router(export_router)
v1.include_router(correlates_router)

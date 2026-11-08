from fastapi import FastAPI

from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.routers import admin_public_routes, auth, favorites, health, me, public_routes, routes


def create_app() -> FastAPI:
    docs = get_settings().api_docs_enabled
    app = FastAPI(
        title="曉行 Routecast API",
        version="0.1.0",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(routes.router)
    app.include_router(public_routes.router)
    app.include_router(favorites.router)
    app.include_router(admin_public_routes.router)
    return app


app = create_app()

from fastapi import FastAPI

from app.core.errors import register_error_handlers
from app.routers import auth, favorites, health, me, public_routes, routes


def create_app() -> FastAPI:
    app = FastAPI(title="曉行 Routecast API", version="0.1.0")
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(routes.router)
    app.include_router(public_routes.router)
    app.include_router(favorites.router)
    return app


app = create_app()

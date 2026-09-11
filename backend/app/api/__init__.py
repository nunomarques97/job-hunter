"""API routers, mounted under /api."""
from fastapi import APIRouter

from . import analytics, applications, automation, candidate, documents, email, jobs, system

api_router = APIRouter(prefix="/api")
api_router.include_router(system.router, tags=["system"])
api_router.include_router(candidate.router, prefix="/profile", tags=["profile"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(applications.router, prefix="/applications", tags=["applications"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(automation.router, prefix="/automation", tags=["automation"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(email.router, prefix="/email", tags=["email"])

__all__ = ["api_router"]

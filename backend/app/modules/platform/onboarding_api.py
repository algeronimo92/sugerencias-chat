"""Checklist de primeros pasos del negocio (solo admins: el guard va en bootstrap)."""

from fastapi import APIRouter

from app.modules.platform.onboarding import dismiss_onboarding, onboarding_status
from app.modules.platform.schemas import OnboardingStatus

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


@router.get("", response_model=OnboardingStatus)
async def get_onboarding():
    return await onboarding_status()


@router.post("/dismiss", response_model=OnboardingStatus)
async def post_dismiss_onboarding():
    return await dismiss_onboarding()

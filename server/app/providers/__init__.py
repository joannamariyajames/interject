from __future__ import annotations

from ..config import settings
from .base import GenerationRequest, Provider
from .mock import MockProvider
from .openai_compat import OpenAICompatProvider


def build_provider() -> Provider:
    if settings.use_real_llm:
        return OpenAICompatProvider()
    return MockProvider()


__all__ = ["GenerationRequest", "Provider", "MockProvider", "OpenAICompatProvider", "build_provider"]

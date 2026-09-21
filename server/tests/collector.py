from __future__ import annotations

from typing import Any

from app.schemas import ServerFrame


class Collector:
    """Captures every frame the runtime emits, the way the browser would."""

    def __init__(self) -> None:
        self.frames: list[dict[str, Any]] = []

    async def __call__(self, frame: ServerFrame) -> None:
        self.frames.append(frame.model_dump())

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [f for f in self.frames if f["t"] == kind]

    def stages(self) -> list[str]:
        return [f["stage"] for f in self.of("stage")]

    def text(self) -> str:
        return "".join(f["text"] for f in self.of("token"))

    def metric(self, name: str) -> float | None:
        for frame in self.of("metric"):
            if frame["name"] == name:
                return frame["value"]
        return None

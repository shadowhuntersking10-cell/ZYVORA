"""AI provider adapters. Each adapter is independent and reads its key from the environment.

Rules:
- No key => status "not_connected". Nothing is generated and nothing is charged.
- A key is present => a real HTTP call is made. Errors are returned as "failed" (never faked).
- Async providers (Meshy, Tripo) return "running" with a provider task id; the jobs
  endpoint polls them.
"""

import base64
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from app.config import get_settings

Status = Literal["succeeded", "running", "failed", "not_connected"]
TIMEOUT = 30.0


@dataclass
class ProviderResult:
    status: Status
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass(frozen=True)
class TaskSpec:
    task: str
    unit_cost: int  # credits per unit
    kind: Literal["sync", "async"]


class ProviderAdapter:
    name: str = ""
    label: str = ""
    key_setting: str = ""
    tasks: dict[str, TaskSpec] = {}

    def api_key(self) -> str | None:
        return getattr(get_settings(), self.key_setting, None) or None

    def is_connected(self) -> bool:
        return self.api_key() is not None

    def status_info(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "label": self.label,
            "connected": self.is_connected(),
            "tasks": [{"task": t.task, "unit_cost": t.unit_cost, "kind": t.kind} for t in self.tasks.values()],
        }

    def not_connected(self) -> ProviderResult:
        return ProviderResult(status="not_connected", error=f"{self.label}: provider not connected")

    def run(self, task: str, prompt: str, units: int) -> ProviderResult:
        if not self.is_connected():
            return self.not_connected()
        if task not in self.tasks:
            return ProviderResult(status="failed", error=f"{self.label}: unsupported task '{task}'")
        try:
            return self._call(task, prompt, units)
        except httpx.HTTPError as exc:
            return ProviderResult(status="failed", error=f"{self.label} request failed: {exc.__class__.__name__}")

    def poll(self, provider_task_id: str) -> ProviderResult:
        return ProviderResult(status="failed", error=f"{self.label}: polling not supported")

    def _call(self, task: str, prompt: str, units: int) -> ProviderResult:
        raise NotImplementedError


class OpenAIAdapter(ProviderAdapter):
    name = "openai"
    label = "OpenAI"
    key_setting = "openai_api_key"
    tasks = {"chat": TaskSpec("chat", 1, "sync")}

    def _call(self, task: str, prompt: str, units: int) -> ProviderResult:
        s = get_settings()
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key()}"},
                json={
                    "model": s.openai_model,
                    "messages": [
                        {"role": "system", "content": "You are ZYVORA AI, an assistant for anime, 3D, animation and cinema production."},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
        if r.status_code >= 400:
            return ProviderResult(status="failed", error=f"OpenAI error {r.status_code}")
        data = r.json()
        text = data["choices"][0]["message"]["content"]
        return ProviderResult(status="succeeded", output={"text": text, "model": data.get("model")})


class MeshyAdapter(ProviderAdapter):
    name = "meshy"
    label = "Meshy"
    key_setting = "meshy_api_key"
    tasks = {"text_to_3d": TaskSpec("text_to_3d", 40, "async")}
    base = "https://api.meshy.ai/openapi/v2/text-to-3d"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key()}"}

    def _call(self, task: str, prompt: str, units: int) -> ProviderResult:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.post(self.base, headers=self._headers(), json={"mode": "preview", "prompt": prompt})
        if r.status_code >= 400:
            return ProviderResult(status="failed", error=f"Meshy error {r.status_code}")
        return ProviderResult(status="running", output={"provider_task_id": r.json().get("result")})

    def poll(self, provider_task_id: str) -> ProviderResult:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.get(f"{self.base}/{provider_task_id}", headers=self._headers())
        if r.status_code >= 400:
            return ProviderResult(status="failed", error=f"Meshy error {r.status_code}")
        d = r.json()
        st = d.get("status")
        if st == "SUCCEEDED":
            return ProviderResult(status="succeeded", output={"provider_task_id": provider_task_id,
                                                              "model_urls": d.get("model_urls", {}),
                                                              "progress": 100})
        if st in ("FAILED", "CANCELED"):
            return ProviderResult(status="failed", error=f"Meshy task {st.lower()}")
        return ProviderResult(status="running", output={"provider_task_id": provider_task_id,
                                                        "progress": d.get("progress", 0)})


class TripoAdapter(ProviderAdapter):
    name = "tripo"
    label = "Tripo"
    key_setting = "tripo_api_key"
    tasks = {"text_to_3d": TaskSpec("text_to_3d", 40, "async")}
    base = "https://api.tripo3d.ai/v2/openapi/task"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key()}"}

    def _call(self, task: str, prompt: str, units: int) -> ProviderResult:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.post(self.base, headers=self._headers(), json={"type": "text_to_model", "prompt": prompt})
        if r.status_code >= 400:
            return ProviderResult(status="failed", error=f"Tripo error {r.status_code}")
        tid = (r.json().get("data") or {}).get("task_id")
        if not tid:
            return ProviderResult(status="failed", error="Tripo returned no task id")
        return ProviderResult(status="running", output={"provider_task_id": tid})

    def poll(self, provider_task_id: str) -> ProviderResult:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.get(f"{self.base}/{provider_task_id}", headers=self._headers())
        if r.status_code >= 400:
            return ProviderResult(status="failed", error=f"Tripo error {r.status_code}")
        d = r.json().get("data") or {}
        st = d.get("status")
        if st == "success":
            return ProviderResult(status="succeeded", output={"provider_task_id": provider_task_id,
                                                              "model": (d.get("output") or {}).get("model"),
                                                              "progress": 100})
        if st in ("failed", "banned", "expired", "cancelled", "unknown"):
            return ProviderResult(status="failed", error=f"Tripo task {st}")
        return ProviderResult(status="running", output={"provider_task_id": provider_task_id,
                                                        "progress": d.get("progress", 0)})


class StabilityAdapter(ProviderAdapter):
    name = "stability"
    label = "Stability AI"
    key_setting = "stability_api_key"
    tasks = {"text_to_image": TaskSpec("text_to_image", 10, "sync")}

    def _call(self, task: str, prompt: str, units: int) -> ProviderResult:
        with httpx.Client(timeout=TIMEOUT) as client:
            r = client.post(
                "https://api.stability.ai/v2beta/stable-image/generate/core",
                headers={"Authorization": f"Bearer {self.api_key()}", "Accept": "image/*"},
                files={"prompt": (None, prompt), "output_format": (None, "png")},
            )
        if r.status_code >= 400:
            return ProviderResult(status="failed", error=f"Stability error {r.status_code}")
        return ProviderResult(status="succeeded", output={
            "mime": "image/png",
            "image_base64": base64.b64encode(r.content).decode("ascii"),
        })


class NotImplementedAdapter(ProviderAdapter):
    """Video and audio providers: the key slot exists, but no endpoint is implemented yet.

    With a key set, the job fails honestly instead of pretending to generate output.
    """

    def _call(self, task: str, prompt: str, units: int) -> ProviderResult:
        return ProviderResult(status="failed", error=f"{self.label}: adapter endpoint not implemented in this build")


class VideoAdapter(NotImplementedAdapter):
    name = "video"
    label = "Video provider"
    key_setting = "video_provider_api_key"
    tasks = {"text_to_video": TaskSpec("text_to_video", 100, "async")}


class AudioAdapter(NotImplementedAdapter):
    name = "audio"
    label = "Audio provider"
    key_setting = "audio_provider_api_key"
    tasks = {"text_to_speech": TaskSpec("text_to_speech", 5, "sync")}


ADAPTERS: dict[str, ProviderAdapter] = {
    a.name: a
    for a in (OpenAIAdapter(), MeshyAdapter(), TripoAdapter(), StabilityAdapter(), VideoAdapter(), AudioAdapter())
}


def get_adapter(name: str) -> ProviderAdapter:
    return ADAPTERS[name]

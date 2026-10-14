"""AI provider adapters.

Design rules:
- An adapter never fakes success. If credentials are missing it reports
  `configured=False` and the job fails fast with an honest message.
- Provider API keys stay server-side; the browser only ever sees metadata.
- HTTP uses the standard library so the platform runs without vendor SDKs.
"""
from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from ..config import Settings, get_settings


class ProviderError(Exception):
    pass


class ProviderNotConfigured(ProviderError):
    pass


def _http_json(url: str, *, method: str = "GET", headers: dict | None = None, payload: dict | None = None, timeout: int = 120) -> tuple[int, dict | bytes]:
    data = None
    hdrs = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "json" in ctype:
                return resp.status, json.loads(body.decode("utf-8", "replace"))
            return resp.status, body
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            detail = {"error": str(exc)}
        raise ProviderError(f"HTTP {exc.code}: {json.dumps(detail)[:300]}") from exc
    except urllib.error.URLError as exc:
        raise ProviderError(f"network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ProviderError("provider timeout") from exc


@dataclass
class ProviderInfo:
    name: str
    label: str
    features: list[str] = field(default_factory=list)
    env_keys: list[str] = field(default_factory=list)
    docs: str = ""


class BaseAdapter:
    name = "base"
    label = "Base"
    info = ProviderInfo(name="base", label="Base")

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        return False

    def test_connection(self) -> tuple[bool, str]:
        raise ProviderNotConfigured(f"{self.label} credentials are not configured")

    # kind mapping: which kinds this adapter can serve
    kinds: tuple[str, ...] = ()

    def submit(self, kind: str, prompt: str, params: dict) -> dict:
        """Run or submit a job. Returns {status, provider_job_id?, result?, meta?}."""
        raise NotImplementedError

    def poll(self, provider_job_id: str, params: dict) -> dict:
        return {"status": "completed"}


# ------------------------------------------------------------------ OpenAI --
class OpenAIAdapter(BaseAdapter):
    name = "openai"
    label = "OpenAI"
    kinds = ("image", "text")
    info = ProviderInfo(
        name="openai",
        label="OpenAI",
        features=["image generation (DALL·E 3)", "text & reasoning (chat)", "assistant tool calling"],
        env_keys=["OPENAI_API_KEY"],
        docs="https://platform.openai.com/api-keys",
    )

    @property
    def configured(self) -> bool:
        return bool(self.settings.openai_api_key)

    def test_connection(self) -> tuple[bool, str]:
        if not self.configured:
            return False, "OPENAI_API_KEY is not set"
        try:
            status, data = _http_json(
                f"{self.settings.openai_base_url}/models",
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                timeout=15,
            )
            return status == 200, "ok" if status == 200 else f"HTTP {status}"
        except ProviderError as exc:
            return False, str(exc)

    def submit(self, kind: str, prompt: str, params: dict) -> dict:
        if not self.configured:
            raise ProviderNotConfigured("OpenAI is not configured: set OPENAI_API_KEY")
        if kind == "text":
            return self._chat(prompt, params)
        return self._image(prompt, params)

    def _chat(self, prompt: str, params: dict) -> dict:
        messages = params.get("messages") or [{"role": "user", "content": prompt}]
        _status, data = _http_json(
            f"{self.settings.openai_base_url}/chat/completions",
            method="POST",
            headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
            payload={"model": params.get("model", "gpt-4o-mini"), "messages": messages, "max_tokens": int(params.get("max_tokens", 1200))},
            timeout=90,
        )
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        return {"status": "completed", "result": {"text": text}, "meta": {"model": data.get("model", "")}}

    def _image(self, prompt: str, params: dict) -> dict:
        size = params.get("size", "1024x1024")
        if size not in ("1024x1024", "1792x1024", "1024x1792"):
            size = "1024x1024"
        _status, data = _http_json(
            f"{self.settings.openai_base_url}/images/generations",
            method="POST",
            headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
            payload={"model": "dall-e-3", "prompt": prompt[:4000], "size": size, "n": 1, "response_format": "b64_json"},
            timeout=180,
        )
        item = (data.get("data") or [{}])[0]
        b64 = item.get("b64_json")
        if not b64:
            raise ProviderError("provider returned no image data")
        return {
            "status": "completed",
            "result": {"image_b64": b64},
            "meta": {"provider": "openai", "size": size},
        }


# --------------------------------------------------------------- Stability --
class StabilityAdapter(BaseAdapter):
    name = "stability"
    label = "Stability AI"
    kinds = ("image",)
    info = ProviderInfo(
        name="stability",
        label="Stability AI",
        features=["image generation (SD3 / core)"],
        env_keys=["STABILITY_API_KEY"],
        docs="https://platform.stability.ai/account/keys",
    )

    @property
    def configured(self) -> bool:
        return bool(self.settings.stability_api_key)

    def test_connection(self) -> tuple[bool, str]:
        if not self.configured:
            return False, "STABILITY_API_KEY is not set"
        return True, "key present (balance check skipped)"

    def submit(self, kind: str, prompt: str, params: dict) -> dict:
        if not self.configured:
            raise ProviderNotConfigured("Stability AI is not configured: set STABILITY_API_KEY")
        aspect = params.get("aspect_ratio", "1:1")
        if aspect not in ("1:1", "16:9", "9:16", "4:3", "3:4"):
            aspect = "1:1"
        boundary = "----zyvoraform"
        body = []
        body.append(f'--{boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n{prompt[:1800]}\r\n'.encode())
        body.append(f'--{boundary}\r\nContent-Disposition: form-data; name="aspect_ratio"\r\n\r\n{aspect}\r\n'.encode())
        body.append(f'--{boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng\r\n'.encode())
        body.append(f"--{boundary}--\r\n".encode())
        payload = b"".join(body)
        req = urllib.request.Request(
            "https://api.stability.ai/v2beta/stable-image/generate/core",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.settings.stability_api_key}",
                "Accept": "image/*",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                image = resp.read()
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8", "replace"))
            except Exception:  # noqa: BLE001
                detail = {}
            raise ProviderError(f"HTTP {exc.code}: {json.dumps(detail)[:300]}") from exc
        except urllib.error.URLError as exc:
            raise ProviderError(f"network error: {exc.reason}") from exc
        return {
            "status": "completed",
            "result": {"image_bytes": image},
            "meta": {"provider": "stability", "aspect_ratio": aspect},
        }


# ------------------------------------------------------------------- Meshy --
class MeshyAdapter(BaseAdapter):
    name = "meshy"
    label = "Meshy"
    kinds = ("3d",)
    info = ProviderInfo(
        name="meshy",
        label="Meshy",
        features=["text-to-3D", "image-to-3D"],
        env_keys=["MESHY_API_KEY"],
        docs="https://docs.meshy.ai",
    )

    @property
    def configured(self) -> bool:
        return bool(self.settings.meshy_api_key)

    def test_connection(self) -> tuple[bool, str]:
        if not self.configured:
            return False, "MESHY_API_KEY is not set"
        return True, "key present"

    def submit(self, kind: str, prompt: str, params: dict) -> dict:
        if not self.configured:
            raise ProviderNotConfigured("Meshy is not configured: set MESHY_API_KEY")
        _status, data = _http_json(
            "https://api.meshy.ai/openapi/v2/text-to-3d",
            method="POST",
            headers={"Authorization": f"Bearer {self.settings.meshy_api_key}"},
            payload={
                "mode": "preview",
                "prompt": prompt[:600],
                "art_style": params.get("art_style", "realistic"),
            },
            timeout=60,
        )
        return {"status": data.get("status", "running"), "provider_job_id": data.get("task_id"), "meta": {"provider": "meshy"}}

    def poll(self, provider_job_id: str, params: dict) -> dict:
        _status, data = _http_json(
            f"https://api.meshy.ai/openapi/v2/text-to-3d/{provider_job_id}",
            headers={"Authorization": f"Bearer {self.settings.meshy_api_key}"},
            timeout=30,
        )
        st = data.get("status", "IN_PROGRESS")
        progress = int(data.get("progress") or 0)
        if st == "SUCCEEDED":
            model_urls = (data.get("model_urls") or {})
            return {"status": "completed", "progress": 100, "result": {"glb_url": model_urls.get("glb"), "obj_url": model_urls.get("obj")}, "meta": {"provider": "meshy"}}
        if st == "FAILED":
            return {"status": "failed", "error": str(data.get("task_error"))[:300]}
        return {"status": "running", "progress": progress}


# ------------------------------------------------------------------ Runway --
class RunwayAdapter(BaseAdapter):
    name = "runway"
    label = "Runway"
    kinds = ("video",)
    info = ProviderInfo(
        name="runway",
        label="Runway",
        features=["text/image-to-video (Gen-3)"],
        env_keys=["RUNWAY_API_KEY"],
        docs="https://docs.dev.runwayml.com",
    )

    @property
    def configured(self) -> bool:
        return bool(self.settings.runway_api_key)

    def test_connection(self) -> tuple[bool, str]:
        if not self.configured:
            return False, "RUNWAY_API_KEY is not set"
        return True, "key present"

    def submit(self, kind: str, prompt: str, params: dict) -> dict:
        if not self.configured:
            raise ProviderNotConfigured("Runway is not configured: set RUNWAY_API_KEY")
        _status, data = _http_json(
            "https://api.dev.runwayml.com/v1/text_to_video",
            method="POST",
            headers={
                "Authorization": f"Bearer {self.settings.runway_api_key}",
                "X-Runway-Version": "2024-11-06",
            },
            payload={"model": "gen3a_turbo", "promptText": prompt[:900], "ratio": "1280:768", "duration": 5},
            timeout=60,
        )
        return {"status": "running", "provider_job_id": data.get("id"), "meta": {"provider": "runway"}}

    def poll(self, provider_job_id: str, params: dict) -> dict:
        _status, data = _http_json(
            f"https://api.dev.runwayml.com/v1/tasks/{provider_job_id}",
            headers={"Authorization": f"Bearer {self.settings.runway_api_key}", "X-Runway-Version": "2024-11-06"},
            timeout=30,
        )
        st = data.get("status")
        progress = int(data.get("progress", 0) or 0)
        if st == "SUCCEEDED":
            outputs = data.get("output") or []
            return {"status": "completed", "progress": 100, "result": {"video_url": outputs[0] if outputs else None}, "meta": {"provider": "runway"}}
        if st == "FAILED":
            return {"status": "failed", "error": str(data.get("failure"))[:300]}
        return {"status": "running", "progress": progress}


ADAPTERS: list[type[BaseAdapter]] = [OpenAIAdapter, StabilityAdapter, MeshyAdapter, RunwayAdapter]


def get_adapter(name: str, settings: Settings | None = None) -> BaseAdapter | None:
    for cls in ADAPTERS:
        if cls.name == name:
            return cls(settings)
    return None


def adapters_for_kind(kind: str, settings: Settings | None = None) -> list[BaseAdapter]:
    s = settings or get_settings()
    found = [cls(s) for cls in ADAPTERS if kind in cls.kinds]
    found.sort(key=lambda a: (not a.configured,))  # configured first
    return found


def provider_status_list(settings: Settings | None = None) -> list[dict[str, Any]]:
    s = settings or get_settings()
    out = []
    for cls in ADAPTERS:
        adapter = cls(s)
        out.append(
            {
                "name": adapter.name,
                "label": adapter.label,
                "features": adapter.info.features,
                "env_keys": adapter.info.env_keys,
                "docs": adapter.info.docs,
                "configured": adapter.configured,
                "kinds": list(adapter.kinds),
            }
        )
    return out

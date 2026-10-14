"""AI Assistant with a strict tool registry over real project state.

- The assistant inspects the actual project; it never guesses scene contents.
- Mutating tools validate inputs and record undo entries.
- Three modes: mentor (explain), copilot (propose -> user approves), agent (execute).
- Planners: OpenAI (when configured) with a local deterministic fallback.
"""
from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..models import Project
from .providers import OpenAIAdapter

COLOR_WORDS = {
    "red": "#e74c3c", "qizil": "#e74c3c", "красн": "#e74c3c",
    "blue": "#3498db", "kok": "#3498db", "ko'k": "#3498db", "кво": "#3498db", "син": "#3498db",
    "green": "#2ecc71", "yashil": "#2ecc71", "зелен": "#2ecc71", "зелён": "#2ecc71",
    "white": "#ecf0f1", "oq": "#ecf0f1", "бел": "#ecf0f1",
    "black": "#2c3e50", "qora": "#2c3e50", "черн": "#2c3e50",
    "yellow": "#f1c40f", "sariq": "#f1c40f", "желт": "#f1c40f", "жёлт": "#f1c40f",
}

PRIMITIVE_WORDS = {
    "cube": ["cube", "kub", "куб"],
    "sphere": ["sphere", "shar", "шар"],
    "cylinder": ["cylinder", "silindr", "цилиндр"],
    "plane": ["plane", "tekislik", "плоскость", "пол"],
    "torus": ["torus", "tor", "тор"],
    "cone": ["cone", "konus", "конус"],
}

ACTION_COLORS = {"red": "red", "qizil": "red", "красн": "red", "blue": "blue", "kok": "blue", "ko'k": "blue", "син": "blue", "green": "green", "yashil": "green", "зелен": "green", "зелён": "green", "yellow": "yellow", "sariq": "yellow", "желт": "yellow", "жёлт": "yellow", "white": "white", "oq": "white", "бел": "white", "black": "black", "qora": "black", "черн": "black"}


@dataclass
class Tool:
    name: str
    description: str
    schema: dict
    destructive: bool = False
    handler: Any = None


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, schema: dict, destructive: bool = False):
    def deco(fn):
        REGISTRY[name] = Tool(name=name, description=description, schema=schema, destructive=destructive, handler=fn)
        return fn
    return deco


class ToolError(Exception):
    pass


# ------------------------------------------------------------ scene helpers --

def _objects(project: Project) -> list[dict]:
    if project.kind == "3d":
        return project.data.setdefault("objects", [])
    raise ToolError("tool works on 3d projects")


def _find_object(objects: list[dict], ref: str | int) -> dict:
    for obj in objects:
        if str(obj.get("id")) == str(ref) or obj.get("name", "").lower() == str(ref).lower():
            return obj
    # fuzzy: name contains ref
    for obj in objects:
        if str(ref).lower() in obj.get("name", "").lower():
            return obj
    raise ToolError(f"object '{ref}' not found")


def _push_undo(project: Project, label: str) -> None:
    undo = project.data.setdefault("_undo", [])
    undo.append({"label": label, "objects": json.loads(json.dumps(project.data.get("objects", [])))})
    if len(undo) > 20:
        del undo[: len(undo) - 20]


def _mark_changed(project: Project) -> None:
    """Persist in-place JSON mutations by explicitly flagging the column."""
    from sqlalchemy.orm.attributes import flag_modified

    from ..models import utcnow

    project.updated_at = utcnow()
    flag_modified(project, "data")


# ------------------------------------------------------------------- tools --

@tool("inspect_project", "Get full project metadata and a scene summary", {"type": "object", "properties": {}, "required": []})
def inspect_project(db: DbSession, project: Project, args: dict) -> dict:
    data = project.data
    summary: dict[str, Any] = {
        "id": project.id,
        "name": project.name,
        "kind": project.kind,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        "version": project.version,
    }
    if project.kind == "3d":
        summary["object_count"] = len(data.get("objects", []))
        summary["objects"] = [
            {"id": o.get("id"), "name": o.get("name"), "type": o.get("type"), "color": o.get("color")}
            for o in data.get("objects", [])
        ]
    elif project.kind in ("2d", "animation"):
        layers = data.get("layers") if project.kind == "2d" else (data.get("frames", [{}])[data.get("active_frame", 0)].get("layers") if data.get("frames") else [])
        summary["layers"] = [{"name": l.get("name"), "visible": l.get("visible", True), "has_image": bool(l.get("image"))} for l in (layers or [])]
    elif project.kind == "character":
        summary["description_length"] = len(data.get("description", ""))
        summary["refs"] = len(data.get("refs", []))
    return summary


@tool("list_objects", "List objects of a 3d scene", {"type": "object", "properties": {}, "required": []})
def list_objects(db: DbSession, project: Project, args: dict) -> dict:
    return {"objects": _objects(project)}


@tool("create_object", "Create a primitive object in a 3d scene", {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["cube", "sphere", "cylinder", "plane", "torus", "cone"]},
        "name": {"type": "string"},
        "position": {"type": "array", "items": {"type": "number"}},
        "color": {"type": "string"},
    },
    "required": ["type"],
})
def create_object(db: DbSession, project: Project, args: dict) -> dict:
    objs = _objects(project)
    typ = args.get("type")
    if typ not in PRIMITIVE_WORDS:
        raise ToolError(f"unsupported type '{typ}'")
    _push_undo(project, f"create {typ}")
    max_id = max([o.get("id", 0) for o in objs] + [0])
    color = args.get("color") or random.choice(["#3498db", "#e74c3c", "#2ecc71", "#f1c40f", "#9b59b6"])
    obj = {
        "id": max_id + 1,
        "name": (args.get("name") or f"{typ.capitalize()} {max_id + 1}").strip()[:60],
        "type": typ,
        "position": [round(float(v), 3) for v in (args.get("position") or [0, 0.5, 0])][:3],
        "rotation": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
        "color": color if str(color).startswith("#") else COLOR_WORDS.get(str(color).lower(), "#3498db"),
        "visible": True,
    }
    if typ == "plane":
        obj["position"][1] = 0
    objs.append(obj)
    _mark_changed(project)
    db.commit()
    return {"created": obj}


@tool("update_transform", "Set position/rotation/scale of an object", {
    "type": "object",
    "properties": {
        "object": {"type": ["string", "integer"]},
        "position": {"type": "array", "items": {"type": "number"}},
        "rotation": {"type": "array", "items": {"type": "number"}},
        "scale": {"type": "array", "items": {"type": "number"}},
    },
    "required": ["object"],
})
def update_transform(db: DbSession, project: Project, args: dict) -> dict:
    objs = _objects(project)
    obj = _find_object(objs, args["object"])
    _push_undo(project, f"transform {obj['name']}")
    for key in ("position", "rotation", "scale"):
        if key in args and isinstance(args[key], list) and len(args[key]) == 3:
            obj[key] = [round(float(v), 3) for v in args[key]]
    _mark_changed(project)
    db.commit()
    return {"updated": {"id": obj["id"], "name": obj["name"], "position": obj["position"], "rotation": obj["rotation"], "scale": obj["scale"]}}


@tool("create_material", "Set the color/material of an object", {
    "type": "object",
    "properties": {"object": {"type": ["string", "integer"]}, "color": {"type": "string"}},
    "required": ["object", "color"],
})
def create_material(db: DbSession, project: Project, args: dict) -> dict:
    objs = _objects(project)
    obj = _find_object(objs, args["object"])
    color = str(args.get("color", "#3498db"))
    if not color.startswith("#"):
        color = COLOR_WORDS.get(color.lower(), "#3498db")
    _push_undo(project, f"material {obj['name']}")
    obj["color"] = color
    _mark_changed(project)
    db.commit()
    return {"updated": {"id": obj["id"], "name": obj["name"], "color": obj["color"]}}


@tool("rename_object", "Rename an object", {
    "type": "object",
    "properties": {"object": {"type": ["string", "integer"]}, "name": {"type": "string"}},
    "required": ["object", "name"],
})
def rename_object(db: DbSession, project: Project, args: dict) -> dict:
    objs = _objects(project)
    obj = _find_object(objs, args["object"])
    name = (args.get("name") or "").strip()
    if not (1 <= len(name) <= 60):
        raise ToolError("invalid name length")
    _push_undo(project, f"rename {obj['name']}")
    obj["name"] = name
    _mark_changed(project)
    db.commit()
    return {"renamed": {"id": obj["id"], "name": name}}


@tool("delete_object", "Delete an object from the scene (destructive)", {
    "type": "object",
    "properties": {"object": {"type": ["string", "integer"]}},
    "required": ["object"],
}, destructive=True)
def delete_object(db: DbSession, project: Project, args: dict) -> dict:
    objs = _objects(project)
    obj = _find_object(objs, args["object"])
    _push_undo(project, f"delete {obj['name']}")
    objs.remove(obj)
    _mark_changed(project)
    db.commit()
    return {"deleted": {"id": obj["id"], "name": obj["name"]}, "remaining": len(objs)}


@tool("undo_last_change", "Undo the last scene change (destructive: reverses state)", {
    "type": "object", "properties": {}, "required": [],
}, destructive=True)
def undo_last_change(db: DbSession, project: Project, args: dict) -> dict:
    undo = project.data.setdefault("_undo", [])
    if not undo:
        return {"undone": False, "reason": "nothing to undo"}
    last = undo.pop()
    project.data["objects"] = last["objects"]
    _mark_changed(project)
    db.commit()
    return {"undone": True, "label": last.get("label")}


# ---------------------------------------------------------------- planning --

def _plan_local(message: str, project: Project) -> tuple[list[dict], str]:
    """Deterministic multilingual rule-based planner (works without API keys)."""
    msg = (message or "").lower().strip()
    actions: list[dict] = []

    if any(w in msg for w in ("ko'rsat", "kursat", "inspect", "show", "покажи", "och", "открой")) or msg in ("scene?", "sahna?"):
        return [], "inspect"

    primitive = None
    for prim, words in PRIMITIVE_WORDS.items():
        if any(w in msg for w in words):
            primitive = prim
            break
    wants_delete = any(w in msg for w in ("o'chir", "ochir", "delete", "remove", "удал", "olib tashla"))
    wants_undo = any(w in msg for w in ("qaytar", "undo", "отмен", "orasiga"))

    if wants_undo:
        actions.append({"tool": "undo_last_change", "args": {}})
        return actions, "apply"

    if wants_delete and primitive is None:
        # find target by remaining words
        target = None
        for obj in project.data.get("objects", []):
            name = (obj.get("name") or "").lower()
            if name and name.split()[0] in msg:
                target = obj["id"]
                break
        if target is None:
            return [], "not_found"
        actions.append({"tool": "delete_object", "args": {"object": target}})
        return actions, "apply"

    if primitive:
        pos = [0, 0.5, 0]
        pos_match = re.findall(r"-?\d+(?:\.\d+)?", msg)
        if len(pos_match) >= 3 and not primitive == "plane":
            nums = [float(x) for x in pos_match[:3]]
            pos = nums
        actions.append({"tool": "create_object", "args": {"type": primitive, "position": pos}})
        color = next((ACTION_COLORS[c] for c in ACTION_COLORS if c in msg), None)
        if color:
            actions.append({"tool": "create_material", "args": {"object": f"@new", "color": color}})
        return actions, "apply"

    color = next((ACTION_COLORS[c] for c in ACTION_COLORS if c in msg), None)
    if color and any(w in msg for w in ("bo'ya", "boyа", "rang", "color", "крас", "покрас", "qil")):
        target = None
        for obj in project.data.get("objects", []):
            name = (obj.get("name") or "").lower()
            if name and name.split()[0] in msg:
                target = obj["id"]
                break
        if target is not None:
            actions.append({"tool": "create_material", "args": {"object": target, "color": color}})
            return actions, "apply"
        if project.data.get("objects"):
            actions.append({"tool": "create_material", "args": {"object": project.data["objects"][-1]["id"], "color": color}})
            return actions, "apply"
        return [], "not_found"

    rename_match = re.search(r"(?:nomini|rename|переименуй)\s+(?:.*\s)?(?:'|\")?([\w\- ]{1,40})(?:'|\")?\s*(?:ga|to|в|на)\s+([\w\- ]{1,40})", msg)
    if rename_match:
        target, new_name = rename_match.group(1).strip(), rename_match.group(2).strip()
        actions.append({"tool": "rename_object", "args": {"object": target, "name": new_name}})
        return actions, "apply"

    return [], "unknown"


MENTOR_TIPS = {
    "3d": "Tip: start with simple primitives, block out the composition, then refine colors and transforms.",
    "2d": "Tip: keep line art and coloring on separate layers so you can edit them independently.",
    "animation": "Tip: animate big motion first (position), then add secondary motion.",
    "character": "Tip: keep the palette to 3-4 main colors for readability.",
}


def plan(db: DbSession, project: Project, message: str, mode: str) -> dict:
    """Returns {reply, actions, mode} — actions only for copilot/agent."""
    s = get_settings()
    planner_note = "local"
    actions: list[dict] = []
    reply = ""

    openai = OpenAIAdapter(s)
    if openai.configured and mode in ("mentor", "copilot", "agent"):
        planner_note = "openai"
        try:
            tools = [
                {"type": "function", "function": {"name": tl.name, "description": tl.description, "parameters": tl.schema}}
                for tl in REGISTRY.values()
            ]
            summary = json.dumps(inspect_project(db, project, {}), ensure_ascii=False)
            outcome = openai.submit("text", "", params={
                "messages": [
                    {"role": "system", "content": (
                        "You are the ZYVORA creative studio assistant. You control the user's real project through tools. "
                        f"Current project state: {summary}. "
                        "In mentor mode explain without tools. In copilot/agent mode call tools to fulfill the request. "
                        f"Current mode: {mode}. Reply in the user's language."
                    )},
                    {"role": "user", "content": message},
                ],
                "tools": tools,
            })
            text = (outcome.get("result") or {}).get("text", "")
            reply = text
            actions = []
        except Exception as exc:  # noqa: BLE001 - degrade honestly to local planner
            planner_note = f"local (openai error: {str(exc)[:120]})"

    if planner_note.startswith("local"):
        actions, intent = _plan_local(message, project)
        lang = project.owner.lang if getattr(project, "owner", None) else "uz"
        from ..i18n import t

        if intent == "inspect":
            summary = inspect_project(db, project, {})
            if project.kind == "3d":
                objs = summary.get("objects", [])
                reply = t(lang, "as.executed", n=0) + "\n" + json.dumps(summary, ensure_ascii=False)[:1200]
            else:
                reply = json.dumps(summary, ensure_ascii=False)[:1200]
            actions = []
        elif intent == "not_found":
            reply = t(lang, "error.generic")
            actions = []
        elif intent == "unknown" and not actions:
            reply = MENTOR_TIPS.get(project.kind, "")
        else:
            reply = t(lang, "as.executed", n=len(actions))

    if mode == "mentor":
        actions = []
    return {"reply": reply, "actions": actions, "mode": mode, "planner": planner_note}


def execute_actions(db: DbSession, project: Project, actions: list[dict]) -> dict:
    """Execute an approved action list through the registry (validating each)."""
    results = []
    for action in actions[:20]:
        name = action.get("tool")
        tl = REGISTRY.get(name)
        if tl is None or tl.handler is None:
            results.append({"tool": name, "ok": False, "error": "unknown tool"})
            continue
        args = action.get("args") or {}
        # allow "@new" object reference: refers to the most recently created object
        for key in ("object",):
            if args.get(key) == "@new" and project.kind == "3d" and project.data.get("objects"):
                args[key] = project.data["objects"][-1]["id"]
        try:
            out = tl.handler(db, project, args)
            results.append({"tool": name, "ok": True, "result": out})
        except ToolError as exc:
            results.append({"tool": name, "ok": False, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            results.append({"tool": name, "ok": False, "error": f"internal: {exc}"})
    return {"results": results, "ok": all(r["ok"] for r in results)}

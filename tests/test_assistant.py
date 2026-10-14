"""AI assistant: local planner, tool execution through the registry, modes."""
import json


def _mk_3d_project(auth):
    r = auth.post("/api/projects", json={"name": "Scene", "kind": "3d"})
    return r.json()["project"]["id"]


def test_inspect_scene_local(auth):
    pid = _mk_3d_project(auth)
    r = auth.post("/api/assistant", json={"project_id": pid, "message": "sahnamni ko'rsat", "mode": "mentor"})
    assert r.status_code == 200
    data = r.json()
    assert data["planner"].startswith("local")
    assert "object_count" in data["reply"]


def test_create_object_via_agent(auth):
    pid = _mk_3d_project(auth)
    r = auth.post("/api/assistant", json={"project_id": pid, "message": "kub qo'sh", "mode": "agent"})
    assert r.status_code == 200
    data = r.json()
    assert data["executed"]["ok"] is True
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    assert len(proj["data"]["objects"]) == 1
    assert proj["data"]["objects"][0]["type"] == "cube"


def test_copilot_requires_approval(auth):
    pid = _mk_3d_project(auth)
    r = auth.post("/api/assistant", json={"project_id": pid, "message": "shar qo'sh", "mode": "copilot"})
    data = r.json()
    assert data["actions"], "copilot proposes actions"
    assert data["executed"] is None
    # not applied yet
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    assert len(proj["data"]["objects"]) == 0
    # approve
    r = auth.post("/api/assistant/execute", json={"project_id": pid, "actions": data["actions"]})
    assert r.json()["ok"] is True
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    assert len(proj["data"]["objects"]) == 1


def test_rename_and_color(auth):
    pid = _mk_3d_project(auth)
    auth.post("/api/assistant/execute", json={
        "project_id": pid,
        "actions": [{"tool": "create_object", "args": {"type": "torus"}}],
    })
    r = auth.post("/api/assistant/execute", json={
        "project_id": pid,
        "actions": [
            {"tool": "rename_object", "args": {"object": "torus", "name": "Ring"}},
            {"tool": "create_material", "args": {"object": "Ring", "color": "red"}},
        ],
    })
    assert r.json()["ok"] is True
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    obj = proj["data"]["objects"][0]
    assert obj["name"] == "Ring"
    assert obj["color"] == "#e74c3c"


def test_delete_and_undo(auth):
    pid = _mk_3d_project(auth)
    auth.post("/api/assistant/execute", json={"project_id": pid, "actions": [{"tool": "create_object", "args": {"type": "cone"}}]})
    r = auth.post("/api/assistant/execute", json={"project_id": pid, "actions": [{"tool": "delete_object", "args": {"object": "cone"}}]})
    assert r.json()["ok"] is True
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    assert len(proj["data"]["objects"]) == 0
    # undo
    r = auth.post("/api/assistant/execute", json={"project_id": pid, "actions": [{"tool": "undo_last_change", "args": {}}]})
    assert r.json()["ok"] is True
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    assert len(proj["data"]["objects"]) == 1


def test_unknown_tool_rejected(auth):
    pid = _mk_3d_project(auth)
    r = auth.post("/api/assistant/execute", json={"project_id": pid, "actions": [{"tool": "rm_rf", "args": {}}]})
    assert r.json()["ok"] is False
    assert r.json()["results"][0]["error"] == "unknown tool"


def test_other_users_project_forbidden(fresh_client, auth):
    r = auth.post("/api/projects", json={"name": "S", "kind": "3d"})
    pid = r.json()["project"]["id"]
    import time

    email = f"x{time.time_ns()}@t.io"
    fresh_client.post("/api/auth/register", json={"name": "Xuser", "email": email, "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "en"})
    csrf = fresh_client.get("/api/me").json()["csrf"]
    r = fresh_client.post("/api/assistant", headers={"X-CSRF-Token": csrf}, json={"project_id": pid, "message": "hi", "mode": "mentor"})
    assert r.status_code == 404

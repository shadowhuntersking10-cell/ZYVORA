"""Projects: CRUD, versions, ownership isolation, size limits."""


def test_project_crud(auth):
    r = auth.post("/api/projects", json={"name": "My Art", "kind": "2d"})
    assert r.status_code == 200
    pid = r.json()["project"]["id"]

    # read back with data
    r = auth.client.get(f"/api/projects/{pid}")
    assert r.status_code == 200
    proj = r.json()["project"]
    assert proj["kind"] == "2d"
    assert "layers" in proj["data"]

    # save data
    data = proj["data"]
    data["layers"][0]["name"] = "Renamed"
    r = auth.put(f"/api/projects/{pid}/data", json={"data": data, "snapshot": True})
    assert r.status_code == 200
    assert r.json()["version"] == 2

    # versions listed
    r = auth.client.get(f"/api/projects/{pid}/versions")
    assert len(r.json()["items"]) == 2

    # rename
    r = auth.patch(f"/api/projects/{pid}", json={"name": "Renamed Art"})
    assert r.json()["name"] == "Renamed Art"

    # list
    r = auth.client.get("/api/projects")
    assert any(p["id"] == pid for p in r.json()["items"])

    # delete (soft)
    r = auth.delete(f"/api/projects/{pid}")
    assert r.status_code == 200
    r = auth.client.get("/api/projects")
    assert not any(p["id"] == pid for p in r.json()["items"])


def test_ownership_isolation(fresh_client, auth):
    r = auth.post("/api/projects", json={"name": "Private", "kind": "3d"})
    pid = r.json()["project"]["id"]

    # another user cannot access
    other_h = make_other(fresh_client)
    r = fresh_client.get(f"/api/projects/{pid}", headers={"X-CSRF-Token": other_h[0]})
    assert r.status_code == 404
    r = fresh_client.put(f"/api/projects/{pid}/data", json={"data": {}}, headers={"X-CSRF-Token": other_h[0]})
    assert r.status_code == 404
    r = fresh_client.delete(f"/api/projects/{pid}", headers={"X-CSRF-Token": other_h[0]})
    assert r.status_code == 404


def make_other(client):
    import time

    email = f"other{time.time_ns()}@test.io"
    r = client.post("/api/auth/register", json={
        "name": "Other User", "email": email, "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "en",
    })
    assert r.status_code == 200
    csrf = client.get("/api/me").json()["csrf"]
    return csrf, email


def test_invalid_kind_rejected(auth):
    r = auth.post("/api/projects", json={"name": "Bad", "kind": "hologram"})
    assert r.status_code == 400


def test_restore_version(auth):
    r = auth.post("/api/projects", json={"name": "Versioned", "kind": "3d"})
    pid = r.json()["project"]["id"]

    auth.put(f"/api/projects/{pid}/data", json={"data": {"objects": [{"id": 1, "name": "A", "type": "cube", "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1], "color": "#fff"}]}, "snapshot": True})
    auth.put(f"/api/projects/{pid}/data", json={"data": {"objects": []}, "snapshot": True})

    r = auth.client.get(f"/api/projects/{pid}/versions")
    versions = [v["version"] for v in r.json()["items"]]
    assert versions == [3, 2, 1]

    # restore v2
    r = auth.post(f"/api/projects/{pid}/restore/2")
    assert r.status_code == 200
    proj = auth.client.get(f"/api/projects/{pid}").json()["project"]
    assert len(proj["data"]["objects"]) == 1


def test_project_too_large_rejected(auth):
    r = auth.post("/api/projects", json={"name": "Big", "kind": "2d"})
    pid = r.json()["project"]["id"]
    big = {"x": "A" * (5 * 1024 * 1024)}
    r = auth.put(f"/api/projects/{pid}/data", json={"data": big})
    assert r.status_code == 413

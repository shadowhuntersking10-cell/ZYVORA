from tests.conftest import auth_header, make_user

DOC = {"schemaVersion": 1, "name": "P", "objects": {"o1": {"id": "o1", "name": "Cube"}},
       "objectOrder": ["o1"]}


def _create(client, token, name="Mine"):
    r = client.post("/api/projects", headers=auth_header(token), json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def test_project_save_persists_document_and_bumps_version(client, user_token):
    p = _create(client, user_token)
    r = client.put(f"/api/projects/{p['id']}/document", headers=auth_header(user_token),
                   json={"document": DOC, "base_version": 1})
    assert r.status_code == 200 and r.json()["version"] == 2
    got = client.get(f"/api/projects/{p['id']}", headers=auth_header(user_token)).json()
    assert got["document"]["objects"]["o1"]["name"] == "Cube"
    assert got["version"] == 2
    versions = client.get(f"/api/projects/{p['id']}/versions", headers=auth_header(user_token)).json()
    assert [v["version"] for v in versions] == [2, 1]


def test_stale_base_version_is_conflict(client, user_token):
    p = _create(client, user_token)
    client.put(f"/api/projects/{p['id']}/document", headers=auth_header(user_token),
               json={"document": DOC, "base_version": 1})
    r = client.put(f"/api/projects/{p['id']}/document", headers=auth_header(user_token),
                   json={"document": DOC, "base_version": 1})
    assert r.status_code == 409


def test_users_cannot_access_each_others_projects(client, user_token):
    p = _create(client, user_token)
    other = make_user(client, "other@example.com")
    h = auth_header(other)
    assert client.get(f"/api/projects/{p['id']}", headers=h).status_code == 404
    assert client.put(f"/api/projects/{p['id']}/document", headers=h,
                      json={"document": DOC, "base_version": 1}).status_code == 404
    assert client.delete(f"/api/projects/{p['id']}", headers=h).status_code == 404
    assert client.get("/api/projects", headers=h).json() == []


def test_admin_role_does_not_grant_project_access(client, user_token, admin_token):
    p = _create(client, user_token)
    assert client.get(f"/api/projects/{p['id']}", headers=auth_header(admin_token)).status_code == 404


def test_rename_duplicate_delete(client, user_token):
    h = auth_header(user_token)
    p = _create(client, user_token, "Original")
    assert client.patch(f"/api/projects/{p['id']}", headers=h, json={"name": "Renamed"}).json()["name"] == "Renamed"
    dup = client.post(f"/api/projects/{p['id']}/duplicate", headers=h).json()
    assert dup["name"] == "Renamed (copy)"
    assert client.delete(f"/api/projects/{p['id']}", headers=h).status_code == 204
    names = [x["name"] for x in client.get("/api/projects", headers=h).json()]
    assert names == ["Renamed (copy)"]


def test_restore_version(client, user_token):
    h = auth_header(user_token)
    p = _create(client, user_token)
    client.put(f"/api/projects/{p['id']}/document", headers=h, json={"document": DOC, "base_version": 1})
    r = client.post(f"/api/projects/{p['id']}/versions/1/restore", headers=h)
    assert r.status_code == 200 and r.json()["version"] == 3
    got = client.get(f"/api/projects/{p['id']}", headers=h).json()
    assert got["document"]["objects"] == {}

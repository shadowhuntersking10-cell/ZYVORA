"""Asset uploads: type/size validation, ownership, deletion."""
import io
import time


def tiny_png() -> bytes:
    # 1x1 transparent PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d4944415478da63fcffff3f0300050201f34a4d8d0000000049454e44ae426082"
    )


def test_upload_png_ok(auth):
    r = auth.post("/api/assets", files={"file": ("test.png", io.BytesIO(tiny_png()), "image/png")})
    assert r.status_code == 200, r.text
    asset = r.json()["asset"]
    assert asset["name"] == "test.png"
    # file served with auth
    r = auth.client.get(f"/api/assets/{asset['id']}/file")
    assert r.status_code == 200
    assert r.content.startswith(b"\x89PNG")


def test_upload_rejects_bad_type(auth):
    r = auth.post("/api/assets", files={"file": ("evil.png", io.BytesIO(b"#!/bin/sh\nrm -rf /"), "image/png")})
    assert r.status_code == 415


def test_upload_rejects_too_big(auth):
    big = b"\x89PNG" + b"0" * (6 * 1024 * 1024)
    r = auth.post("/api/assets", files={"file": ("big.png", io.BytesIO(big), "image/png")})
    assert r.status_code == 413


def test_ownership_on_file_serve(fresh_client, auth):
    r = auth.post("/api/assets", files={"file": ("mine.png", io.BytesIO(tiny_png()), "image/png")})
    aid = r.json()["asset"]["id"]
    # anonymous (fresh client has no cookies yet)
    assert fresh_client.get(f"/api/assets/{aid}/file").status_code == 401
    # other user
    import time

    email = f"o{time.time_ns()}@t.io"
    reg = fresh_client.post("/api/auth/register", json={"name": "Other", "email": email, "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "en"})
    assert reg.status_code == 200, reg.text
    assert fresh_client.get(f"/api/assets/{aid}/file").status_code == 404


def test_delete_asset(auth):
    r = auth.post("/api/assets", files={"file": ("del.png", io.BytesIO(tiny_png()), "image/png")})
    aid = r.json()["asset"]["id"]
    assert auth.delete(f"/api/assets/{aid}").status_code == 200
    assert auth.client.get(f"/api/assets/{aid}/file").status_code == 404

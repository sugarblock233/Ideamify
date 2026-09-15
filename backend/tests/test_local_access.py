"""Local-only mode uses isolated subprocesses so config/engine globals cannot
reuse the token-mode smoke suite's settings. All records below are synthetic.
"""
import os
from pathlib import Path
import subprocess
import sys


def test_local_mode_without_tokens(tmp_path):
    code = r'''
import uuid
from starlette.testclient import TestClient
from app.main import app
c = TestClient(app, base_url="http://127.0.0.1:8000")
r = c.get("/api/v1/session")
assert r.status_code == 200 and r.json()["auth_mode"] == "local"
assert r.json()["actor"] == "researcher"
assert not c.cookies and r.headers["cache-control"] == "no-store"
body = {"request_id": str(uuid.uuid4()), "name": "Synthetic local project", "objective": "Local API regression"}
assert c.post("/api/v1/projects", json=body).status_code == 403
assert c.post("/api/v1/projects", json=body, headers={"x-researchmap-request":"1", "origin":"https://untrusted.invalid"}).status_code == 403
assert c.get("/api/v1/projects", headers={"origin":"http://localhost:9000"}).status_code == 403
assert c.get("/api/v1/projects", headers={"host":"rebound.invalid"}).status_code == 403
assert c.get("/api/v1/projects", headers={"sec-fetch-site":"cross-site"}).status_code == 403
assert c.get("/api/v1/projects", headers={"authorization":"Bearer invalid"}).status_code == 401
r = c.post("/api/v1/projects", json=body, headers={"x-researchmap-request":"1", "origin":"http://127.0.0.1:8000"})
assert r.status_code == 200, r.text
pid = r.json()["id"]
assert c.get(f"/api/v1/projects/{pid}/graph").status_code == 200
assert c.get(f"/api/v1/projects/{pid}/export").status_code == 200
assert c.get("/api/v1/openapi.json").status_code == 200
assert c.get(f"/api/v1/projects/{pid}").json()["created_by"] == "researcher"
# Default mode is also local; token mode without configured credentials fails closed.
from app.config import get_settings
import os
os.environ.pop("RESEARCHMAP_AUTH_MODE")
assert get_settings().auth_mode == "local"
os.environ["RESEARCHMAP_AUTH_MODE"] = "token"
try:
    get_settings()
except RuntimeError:
    pass
else:
    raise AssertionError("token mode must require configured credentials")
'''
    env = {**os.environ, "RESEARCHMAP_DB": str(tmp_path / "local.db"),
           "RESEARCHMAP_STORAGE": str(tmp_path / "attachments"),
           "RESEARCHMAP_STATIC": "", "RESEARCHMAP_TOKENS": "",
           "RESEARCHMAP_AUTH_MODE": "local"}
    result = subprocess.run([sys.executable, "-c", code], env=env,
                            cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr

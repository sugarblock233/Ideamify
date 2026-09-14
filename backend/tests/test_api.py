"""Pytest entry for the ASGI smoke suite (tests/api_smoke.py).

Environment is configured here **before** the app is first imported, so the
SQLite engine binds to a per-test temp database. The smoke script prints one
PASS/FAIL line per check and a final line "<passed>/<total> passed" (and exits
non-zero on any failure). New checks added to api_smoke.py need no change to
this wrapper: we parse that final line and assert zero failures.
"""

import contextlib
import io
import re
import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent

TOKENS = '{"researcher": "researcher-token-0001", ' \
         '"ai-sim": "ai-sim-token-0001"}'


def test_api_smoke(tmp_path, monkeypatch):
    # Values must match the TOK table inside api_smoke.py (auth checks).
    monkeypatch.setenv("RESEARCHMAP_DB", str(tmp_path / "api_smoke.db"))
    monkeypatch.setenv("RESEARCHMAP_TOKENS", TOKENS)
    monkeypatch.setenv("RESEARCHMAP_STATIC", "")
    monkeypatch.delenv("RESEARCHMAP_CORS_ORIGINS", raising=False)

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            runpy.run_path(str(HERE / "api_smoke.py"), run_name="__main__")
            rc = 0
        except SystemExit as e:
            rc = int(e.code or 0)
    out = buf.getvalue()

    m = re.search(r"^(\d+)/(\d+) passed$", out, flags=re.MULTILINE)
    assert m, f"smoke output缺少通过计数，尾部: …{out[-2000:]}"
    passed, total = int(m.group(1)), int(m.group(2))
    assert passed > 0, "检查数为 0：" + out[:2000]
    assert "FAIL " not in out, out
    assert passed == total, out
    assert rc == 0, f"smoke exit code {rc}\n{out}"
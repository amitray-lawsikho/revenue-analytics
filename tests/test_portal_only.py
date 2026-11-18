"""The dashboard has no sign-in of its own: it opens only through the Sales Intelligence Portal (Amit, 18 Nov 2026)."""
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"


def test_no_own_sign_in():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert "signInWithPassword" not in js and "signUp(" not in js
    assert 'type="password"' not in html
    assert "go.html?d=" in js and "toPortal(" in js
    assert 'signOut({ scope: "local" })' in js

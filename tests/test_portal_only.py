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


def test_student_export_follows_the_view():
    """Student Dictionary Export (Amit, 20 Nov 2026): the chosen flag, dates, filters and search, every page, as CSV."""
    js = (WEB / "app.js").read_text(encoding="utf-8")
    i = js.index("async function exportStudents")
    body = js[i:js.index("\n}\n", i)]
    assert 'p_flag: st.flag || null' in body and 'p_search: st.q || null' in body and "p_limit: 200" in body
    assert "for (let off = 0; off < total; off += 200)" in body and "text/csv" in body


def test_update_button_admins_only():
    """Amit, 25 Nov 2026: Update data shows only for Revenue admins (rev_can_update; request_refresh and portal-sync refuse viewers)."""
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    assert '<button id="update" class="btn primary block" hidden>' in root.joinpath("web", "index.html").read_text()
    assert 'sb.rpc("rev_can_update")' in root.joinpath("web", "app.js").read_text()
    assert "role !== 'admin'" in root.joinpath("supabase", "functions", "portal-sync", "index.ts").read_text()

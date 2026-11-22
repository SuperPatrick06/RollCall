import asyncio
import importlib

import httpx


async def login(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post("/api/auth/login", json={"password": "2006"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_complete_workflow(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTENDANCE_DB_PATH", str(tmp_path / "test.db"))
    database = importlib.import_module("app.database")
    main = importlib.import_module("app.main")
    database.initialize_database()

    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.get("/api/health")).json() == {"status": "ok"}
            wrong = await client.post("/api/auth/login", json={"password": "wrong"})
            assert wrong.status_code == 401
            headers = await login(client)

            member = await client.post(
                "/api/members",
                json={"member_no": "A001", "name": "测试成员", "enrollment_year": "26-27"},
                headers=headers,
            )
            assert member.status_code == 201
            assert member.json()["enrollment_year"] == "26-27"

            listed = await client.get("/api/members", headers=headers)
            assert listed.json()[0]["enrollment_year"] == "26-27"

            plan = await client.put(
                "/api/training-plans/2026-08",
                json={"planned_minutes": 600, "note": "八月计划"},
                headers=headers,
            )
            assert plan.status_code == 200

            attendance = await client.post(
                "/api/attendance",
                json={
                    "member_no": "A001",
                    "training_date": "2026-08-03",
                    "minutes": 120,
                    "action": "credit",
                },
                headers=headers,
            )
            assert attendance.status_code == 201

            violation = await client.post(
                "/api/violations",
                json={
                    "member_no": "A001",
                    "behavior": "迟到",
                    "deducted_minutes": 30,
                    "violation_date": "2026-08-03",
                },
                headers=headers,
            )
            assert violation.status_code == 201

            exam = await client.post(
                "/api/exams",
                json={
                    "exam_name": "八月考核",
                    "member_no": "A001",
                    "project": "实操项目",
                    "score": 92,
                    "exam_date": "2026-08-03",
                },
                headers=headers,
            )
            assert exam.status_code == 201

            analytics = await client.get(
                "/api/analytics/attendance?month=2026-08", headers=headers
            )
            assert analytics.status_code == 200
            result = analytics.json()
            assert result["planned_minutes"] == 600
            assert result["members"][0]["credited_minutes"] == 120
            assert result["members"][0]["deducted_minutes"] == 30
            assert result["members"][0]["net_minutes"] == 90
            assert result["members"][0]["attendance_rate"] == 15.0
            assert result["members"][0]["average_score"] == 92

            summary = await client.get(
                "/api/attendance/day-summary?training_date=2026-08-03",
                headers=headers,
            )
            assert summary.json()["attendance_count"] == 1

    asyncio.run(scenario())


def test_migration_adds_email_column(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTENDANCE_DB_PATH", str(tmp_path / "legacy.db"))
    database = importlib.import_module("app.database")

    # Simulate a pre-existing database whose members table has no email column.
    with database.connect() as db:
        db.execute(
            """
            CREATE TABLE members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_no TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            "INSERT INTO members(member_no, name, created_at) VALUES ('A001', '老成员', '2026-01-01')"
        )

    database.initialize_database()

    with database.connect() as db:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(members)").fetchall()}
        assert "email" in columns
        assert "enrollment_year" in columns
        # Existing row survives with empty defaults for the new columns.
        row = db.execute(
            "SELECT email, enrollment_year FROM members WHERE member_no = 'A001'"
        ).fetchone()
        assert row["email"] == ""
        assert row["enrollment_year"] == ""


def test_email_settings_and_reports(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTENDANCE_DB_PATH", str(tmp_path / "email.db"))
    database = importlib.import_module("app.database")
    email_service = importlib.import_module("app.email_service")
    main = importlib.import_module("app.main")
    database.initialize_database()

    # Capture outgoing mail instead of hitting a real SMTP server.
    sent_messages = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=20):
            self.host = host

        def starttls(self):
            pass

        def login(self, username, password):
            pass

        def send_message(self, message):
            sent_messages.append(message)

        def quit(self):
            pass

    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", FakeSMTP)

    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            headers = await login(client)

            # Member with an email + member without one.
            with_email = await client.post(
                "/api/members",
                json={"member_no": "A001", "name": "有邮箱", "email": "a001@example.com"},
                headers=headers,
            )
            assert with_email.status_code == 201
            assert with_email.json()["email"] == "a001@example.com"
            await client.post(
                "/api/members",
                json={"member_no": "A002", "name": "无邮箱"},
                headers=headers,
            )

            # Reject a malformed email.
            bad = await client.post(
                "/api/members",
                json={"member_no": "A003", "name": "坏邮箱", "email": "not-an-email"},
                headers=headers,
            )
            assert bad.status_code == 422

            # Sending before SMTP is configured returns a clear error.
            not_ready = await client.post("/api/email/send", json={"month": "2026-08"}, headers=headers)
            assert not_ready.status_code == 400

            # Save SMTP settings; password must not be echoed back.
            saved = await client.put(
                "/api/email/settings",
                json={
                    "smtp_host": "smtp.example.com",
                    "smtp_port": 465,
                    "smtp_username": "team@example.com",
                    "smtp_password": "secret-token",
                    "sender_name": "RollCall",
                    "from_email": "team@example.com",
                    "use_ssl": True,
                    "auto_enabled": False,
                },
                headers=headers,
            )
            assert saved.status_code == 200
            assert "smtp_password" not in saved.json()
            assert saved.json()["password_set"] is True

            settings_back = await client.get("/api/email/settings", headers=headers)
            assert settings_back.json()["smtp_host"] == "smtp.example.com"
            assert settings_back.json()["password_set"] is True

            # Manual push: one sent, one skipped (no email).
            result = await client.post("/api/email/send", json={"month": "2026-08"}, headers=headers)
            assert result.status_code == 200
            body = result.json()
            assert body["sent"] == 1
            assert body["skipped"] == 1
            assert body["failed"] == 0
            assert len(sent_messages) == 1

            logs = await client.get("/api/email/logs", headers=headers)
            statuses = {row["status"] for row in logs.json()}
            assert statuses == {"sent", "skipped"}

    asyncio.run(scenario())


def test_unknown_member_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTENDANCE_DB_PATH", str(tmp_path / "unknown.db"))
    database = importlib.import_module("app.database")
    main = importlib.import_module("app.main")
    database.initialize_database()

    async def scenario():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            headers = await login(client)
            response = await client.post(
                "/api/attendance",
                json={
                    "member_no": "NONE",
                    "training_date": "2026-08-03",
                    "minutes": 60,
                    "action": "credit",
                },
                headers=headers,
            )
            assert response.status_code == 404

    asyncio.run(scenario())

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator


DEFAULT_PASSWORD = "2006"


def database_path() -> Path:
    configured = os.getenv("ATTENDANCE_DB_PATH")
    if configured:
        return Path(configured).resolve()
    return (Path(__file__).resolve().parents[1] / "data" / "attendance.db").resolve()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), 210_000
    )
    return digest.hex()


def initialize_database() -> None:
    schema = """
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        enrollment_year TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL REFERENCES members(id),
        training_date TEXT NOT NULL,
        minutes INTEGER NOT NULL CHECK (minutes > 0),
        action TEXT NOT NULL CHECK (action IN ('credit', 'deduction')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date
        ON attendance_records(training_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_member
        ON attendance_records(member_id);

    CREATE TABLE IF NOT EXISTS training_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL UNIQUE,
        planned_minutes INTEGER NOT NULL CHECK (planned_minutes >= 0),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_name TEXT NOT NULL,
        member_id INTEGER NOT NULL REFERENCES members(id),
        project TEXT NOT NULL,
        score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
        exam_date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_exam_member_date
        ON exam_scores(member_id, exam_date);

    CREATE TABLE IF NOT EXISTS violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL REFERENCES members(id),
        behavior TEXT NOT NULL,
        deducted_minutes INTEGER NOT NULL CHECK (deducted_minutes > 0),
        violation_date TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_violation_member_date
        ON violations(member_id, violation_date);

    CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK (category IN ('attendance', 'exam', 'violation')),
        action TEXT NOT NULL CHECK (action IN ('add', 'delete')),
        detail TEXT NOT NULL,
        operator_ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_created
        ON operation_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_category
        ON operation_logs(category);

    CREATE TABLE IF NOT EXISTS email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER REFERENCES members(id),
        recipient TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        month TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_logs_created
        ON email_logs(created_at DESC);
    """
    with connect() as db:
        db.executescript(schema)
        _migrate(db)
        existing = db.execute(
            "SELECT value FROM settings WHERE key = 'password_hash'"
        ).fetchone()
        if existing is None:
            salt = secrets.token_hex(16)
            password_hash = hash_password(DEFAULT_PASSWORD, salt)
            db.executemany(
                "INSERT INTO settings(key, value) VALUES (?, ?)",
                [("password_salt", salt), ("password_hash", password_hash)],
            )


def _migrate(db: sqlite3.Connection) -> None:
    """Apply lightweight schema migrations to pre-existing databases."""
    columns = {row["name"] for row in db.execute("PRAGMA table_info(members)").fetchall()}
    if "email" not in columns:
        db.execute("ALTER TABLE members ADD COLUMN email TEXT NOT NULL DEFAULT ''")
    if "enrollment_year" not in columns:
        db.execute("ALTER TABLE members ADD COLUMN enrollment_year TEXT NOT NULL DEFAULT ''")


# Default values for the SMTP / auto-push settings stored in the settings table.
EMAIL_SETTING_DEFAULTS = {
    "email_smtp_host": "",
    "email_smtp_port": "465",
    "email_smtp_username": "",
    "email_smtp_password": "",
    "email_sender_name": "RollCall",
    "email_from": "",
    "email_use_ssl": "1",
    "email_auto_enabled": "0",
    "email_last_sent_month": "",
}


def get_email_settings(db: sqlite3.Connection) -> dict[str, str]:
    """Return all email_* settings merged over their defaults."""
    stored = {
        row["key"]: row["value"]
        for row in db.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'email\\_%' ESCAPE '\\'"
        ).fetchall()
    }
    return {**EMAIL_SETTING_DEFAULTS, **stored}


def set_email_settings(db: sqlite3.Connection, values: dict[str, str]) -> None:
    """Upsert the provided email_* settings key/value pairs."""
    for key, value in values.items():
        db.execute(
            """
            INSERT INTO settings(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

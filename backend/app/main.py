from __future__ import annotations

import asyncio
import calendar
import secrets
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware

from .database import (
    connect,
    get_email_settings,
    hash_password,
    initialize_database,
    now_iso,
    set_email_settings,
    token_digest,
)
from . import email_service
from .schemas import (
    AttendanceCreate,
    ChangePasswordRequest,
    EmailSendRequest,
    EmailSettingsUpdate,
    EmailTestRequest,
    ExamCreate,
    LoginRequest,
    MemberCreate,
    MemberUpdate,
    TrainingPlanUpsert,
    ViolationCreate,
    validate_month,
)


SESSION_DAYS = 30


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    scheduler = asyncio.create_task(auto_push_scheduler())
    try:
        yield
    finally:
        scheduler.cancel()
        try:
            await scheduler
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="RollCall Attendance API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def row_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def verify_password(db: sqlite3.Connection, password: str) -> bool:
    settings = {
        row["key"]: row["value"]
        for row in db.execute(
            "SELECT key, value FROM settings WHERE key IN ('password_salt', 'password_hash')"
        ).fetchall()
    }
    supplied = hash_password(password, settings["password_salt"])
    return secrets.compare_digest(supplied, settings["password_hash"])


def create_session(db: sqlite3.Connection) -> str:
    token = secrets.token_urlsafe(32)
    created = datetime.now().astimezone()
    expires = created + timedelta(days=SESSION_DAYS)
    db.execute(
        "INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?, ?, ?)",
        (
            token_digest(token),
            created.isoformat(timespec="seconds"),
            expires.isoformat(timespec="seconds"),
        ),
    )
    return token


def require_auth(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先输入访问密码")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态无效")
    with connect() as db:
        session = db.execute(
            "SELECT expires_at FROM sessions WHERE token_hash = ?", (token_digest(token),)
        ).fetchone()
        if session is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")
        if datetime.fromisoformat(session["expires_at"]) <= datetime.now().astimezone():
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已过期")
    return token


AuthToken = Annotated[str, Depends(require_auth)]


def get_member(db: sqlite3.Connection, member_no: str, active_only: bool = True) -> sqlite3.Row:
    query = "SELECT * FROM members WHERE member_no = ?"
    params: tuple = (member_no.strip(),)
    if active_only:
        query += " AND active = 1"
    member = db.execute(query, params).fetchone()
    if member is None:
        raise HTTPException(status_code=404, detail=f"未找到成员编号 {member_no}")
    return member


def month_bounds(month: str) -> tuple[str, str]:
    validate_month(month)
    start = date.fromisoformat(f"{month}-01")
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    return start.isoformat(), end.isoformat()


def record_log(
    db: sqlite3.Connection,
    category: str,
    action: str,
    detail: str,
    operator_ip: str,
) -> None:
    db.execute(
        "INSERT INTO operation_logs(category, action, detail, operator_ip, created_at) VALUES (?, ?, ?, ?, ?)",
        (category, action, detail, operator_ip, now_iso()),
    )


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict:
    with connect() as db:
        if not verify_password(db, payload.password):
            raise HTTPException(status_code=401, detail="密码错误")
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_iso(),))
        token = create_session(db)
    return {"token": token, "expires_in_days": SESSION_DAYS}


@app.get("/api/auth/verify")
def verify(_: AuthToken) -> dict:
    return {"authenticated": True}


@app.put("/api/auth/password")
def change_password(payload: ChangePasswordRequest, token: AuthToken) -> dict:
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    with connect() as db:
        if not verify_password(db, payload.current_password):
            raise HTTPException(status_code=400, detail="当前密码错误")
        salt = secrets.token_hex(16)
        password_hash = hash_password(payload.new_password, salt)
        db.execute("UPDATE settings SET value = ? WHERE key = 'password_salt'", (salt,))
        db.execute("UPDATE settings SET value = ? WHERE key = 'password_hash'", (password_hash,))
        db.execute("DELETE FROM sessions WHERE token_hash != ?", (token_digest(token),))
    return {"message": "密码已更新，其他设备需要重新验证"}


@app.get("/api/members")
def list_members(_: AuthToken, include_inactive: bool = False) -> list[dict]:
    query = "SELECT * FROM members"
    if not include_inactive:
        query += " WHERE active = 1"
    query += " ORDER BY member_no COLLATE NOCASE"
    with connect() as db:
        return [dict(row) for row in db.execute(query).fetchall()]


@app.post("/api/members", status_code=201)
def create_member(payload: MemberCreate, _: AuthToken) -> dict:
    with connect() as db:
        try:
            cursor = db.execute(
                "INSERT INTO members(member_no, name, email, enrollment_year, created_at) VALUES (?, ?, ?, ?, ?)",
                (payload.member_no, payload.name, payload.email, payload.enrollment_year, now_iso()),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="成员编号已存在") from exc
        return dict(db.execute("SELECT * FROM members WHERE id = ?", (cursor.lastrowid,)).fetchone())


@app.patch("/api/members/{member_id}")
def update_member(member_id: int, payload: MemberUpdate, _: AuthToken) -> dict:
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="没有需要更新的内容")
    if "active" in changes:
        changes["active"] = int(changes["active"])
    assignments = ", ".join(f"{key} = ?" for key in changes)
    with connect() as db:
        try:
            cursor = db.execute(
                f"UPDATE members SET {assignments} WHERE id = ?",
                (*changes.values(), member_id),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="成员编号已存在") from exc
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="未找到该成员")
        return dict(db.execute("SELECT * FROM members WHERE id = ?", (member_id,)).fetchone())


@app.post("/api/attendance", status_code=201)
def create_attendance(payload: AttendanceCreate, request: Request, _: AuthToken) -> dict:
    with connect() as db:
        member = get_member(db, payload.member_no)
        cursor = db.execute(
            """
            INSERT INTO attendance_records(member_id, training_date, minutes, action, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                member["id"],
                payload.training_date.isoformat(),
                payload.minutes,
                payload.action,
                payload.note,
                now_iso(),
            ),
        )
        row = db.execute(
            """
            SELECT a.*, m.member_no, m.name
            FROM attendance_records a JOIN members m ON m.id = a.member_id
            WHERE a.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
        ip = get_client_ip(request)
        action_label = "签到" if payload.action == "credit" else "扣除时长"
        hours = payload.minutes / 60
        detail = f"成员{member['member_no']} {member['name']} {action_label} {hours:.1f}小时（{payload.training_date}）"
        if payload.note:
            detail += f" 备注：{payload.note}"
        record_log(db, "attendance", "add", detail, ip)
        return dict(row)


@app.get("/api/attendance")
def list_attendance(
    _: AuthToken,
    training_date: date | None = None,
    limit: int = Query(default=30, ge=1, le=200),
) -> list[dict]:
    where = "WHERE a.training_date = ?" if training_date else ""
    params: tuple = (training_date.isoformat(), limit) if training_date else (limit,)
    with connect() as db:
        rows = db.execute(
            f"""
            SELECT a.*, m.member_no, m.name
            FROM attendance_records a JOIN members m ON m.id = a.member_id
            {where}
            ORDER BY a.training_date DESC, a.id DESC LIMIT ?
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]


@app.get("/api/attendance/day-summary")
def attendance_day_summary(training_date: date, _: AuthToken) -> dict:
    with connect() as db:
        row = db.execute(
            """
            SELECT
                COUNT(DISTINCT CASE WHEN action = 'credit' THEN member_id END) AS attendance_count,
                COALESCE(SUM(CASE WHEN action = 'credit' THEN minutes ELSE 0 END), 0) AS credited_minutes,
                COALESCE(SUM(CASE WHEN action = 'deduction' THEN minutes ELSE 0 END), 0) AS deducted_minutes
            FROM attendance_records WHERE training_date = ?
            """,
            (training_date.isoformat(),),
        ).fetchone()
        return {"training_date": training_date.isoformat(), **dict(row)}


@app.delete("/api/attendance/{record_id}", status_code=204)
def delete_attendance(record_id: int, request: Request, _: AuthToken) -> None:
    with connect() as db:
        row = db.execute(
            """
            SELECT a.*, m.member_no, m.name
            FROM attendance_records a JOIN members m ON m.id = a.member_id
            WHERE a.id = ?
            """,
            (record_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="未找到该签到记录")
        ip = get_client_ip(request)
        action_label = "签到" if row["action"] == "credit" else "扣除时长"
        hours = row["minutes"] / 60
        detail = f"撤销成员{row['member_no']} {row['name']} 的{action_label}记录（{row['training_date']}，{hours:.1f}小时）"
        db.execute("DELETE FROM attendance_records WHERE id = ?", (record_id,))
        record_log(db, "attendance", "delete", detail, ip)


@app.get("/api/training-plans")
def list_training_plans(_: AuthToken) -> list[dict]:
    with connect() as db:
        return [
            dict(row)
            for row in db.execute("SELECT * FROM training_plans ORDER BY month DESC").fetchall()
        ]


@app.put("/api/training-plans/{month}")
def upsert_training_plan(month: str, payload: TrainingPlanUpsert, _: AuthToken) -> dict:
    try:
        validate_month(month)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    timestamp = now_iso()
    with connect() as db:
        db.execute(
            """
            INSERT INTO training_plans(month, planned_minutes, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(month) DO UPDATE SET
                planned_minutes = excluded.planned_minutes,
                note = excluded.note,
                updated_at = excluded.updated_at
            """,
            (month, payload.planned_minutes, payload.note.strip(), timestamp, timestamp),
        )
        return dict(db.execute("SELECT * FROM training_plans WHERE month = ?", (month,)).fetchone())


@app.post("/api/exams", status_code=201)
def create_exam(payload: ExamCreate, request: Request, _: AuthToken) -> dict:
    with connect() as db:
        member = get_member(db, payload.member_no)
        cursor = db.execute(
            """
            INSERT INTO exam_scores(exam_name, member_id, project, score, exam_date, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.exam_name,
                member["id"],
                payload.project,
                payload.score,
                payload.exam_date.isoformat(),
                payload.note,
                now_iso(),
            ),
        )
        row = db.execute(
            """
            SELECT e.*, m.member_no, m.name FROM exam_scores e
            JOIN members m ON m.id = e.member_id WHERE e.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
        ip = get_client_ip(request)
        detail = f"成员{member['member_no']} {member['name']} 考试「{payload.exam_name}」/{payload.project} 分数{payload.score}"
        if payload.note:
            detail += f" 备注：{payload.note}"
        record_log(db, "exam", "add", detail, ip)
        return dict(row)


@app.get("/api/exams")
def list_exams(_: AuthToken, limit: int = Query(default=50, ge=1, le=200)) -> list[dict]:
    with connect() as db:
        rows = db.execute(
            """
            SELECT e.*, m.member_no, m.name FROM exam_scores e
            JOIN members m ON m.id = e.member_id
            ORDER BY e.exam_date DESC, e.id DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


@app.delete("/api/exams/{exam_id}", status_code=204)
def delete_exam(exam_id: int, request: Request, _: AuthToken) -> None:
    with connect() as db:
        row = db.execute(
            """
            SELECT e.*, m.member_no, m.name FROM exam_scores e
            JOIN members m ON m.id = e.member_id WHERE e.id = ?
            """,
            (exam_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="未找到该考试记录")
        ip = get_client_ip(request)
        detail = f"撤销成员{row['member_no']} {row['name']} 的考试记录：{row['exam_name']}/{row['project']} 分数{row['score']}"
        db.execute("DELETE FROM exam_scores WHERE id = ?", (exam_id,))
        record_log(db, "exam", "delete", detail, ip)


@app.post("/api/violations", status_code=201)
def create_violation(payload: ViolationCreate, request: Request, _: AuthToken) -> dict:
    with connect() as db:
        member = get_member(db, payload.member_no)
        cursor = db.execute(
            """
            INSERT INTO violations(member_id, behavior, deducted_minutes, violation_date, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                member["id"],
                payload.behavior,
                payload.deducted_minutes,
                payload.violation_date.isoformat(),
                payload.note,
                now_iso(),
            ),
        )
        row = db.execute(
            """
            SELECT v.*, m.member_no, m.name FROM violations v
            JOIN members m ON m.id = v.member_id WHERE v.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
        ip = get_client_ip(request)
        hours = payload.deducted_minutes / 60
        detail = f"成员{member['member_no']} {member['name']} 违规：{payload.behavior}，扣除{hours:.1f}小时（{payload.violation_date}）"
        if payload.note:
            detail += f" 备注：{payload.note}"
        record_log(db, "violation", "add", detail, ip)
        return dict(row)


@app.get("/api/violations")
def list_violations(_: AuthToken, limit: int = Query(default=50, ge=1, le=200)) -> list[dict]:
    with connect() as db:
        rows = db.execute(
            """
            SELECT v.*, m.member_no, m.name FROM violations v
            JOIN members m ON m.id = v.member_id
            ORDER BY v.violation_date DESC, v.id DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


@app.delete("/api/violations/{violation_id}", status_code=204)
def delete_violation(violation_id: int, request: Request, _: AuthToken) -> None:
    with connect() as db:
        row = db.execute(
            """
            SELECT v.*, m.member_no, m.name FROM violations v
            JOIN members m ON m.id = v.member_id WHERE v.id = ?
            """,
            (violation_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="未找到该违规记录")
        ip = get_client_ip(request)
        detail = f"撤销成员{row['member_no']} {row['name']} 的违规记录：{row['behavior']}，扣除{row['deducted_minutes']}分钟"
        db.execute("DELETE FROM violations WHERE id = ?", (violation_id,))
        record_log(db, "violation", "delete", detail, ip)


@app.get("/api/logs")
def list_logs(
    _: AuthToken,
    category: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict]:
    if category and category not in {"attendance", "exam", "violation"}:
        raise HTTPException(status_code=400, detail="category 必须是 attendance、exam 或 violation")
    with connect() as db:
        if category:
            rows = db.execute(
                "SELECT * FROM operation_logs WHERE category = ? ORDER BY created_at DESC LIMIT ?",
                (category, limit),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]


def analytics_rows(db: sqlite3.Connection, start: str | None, end: str | None) -> list[dict]:
    date_filter_a = "AND a.training_date >= ? AND a.training_date < ?" if start else ""
    date_filter_v = "AND v.violation_date >= ? AND v.violation_date < ?" if start else ""
    date_filter_e = "AND e.exam_date >= ? AND e.exam_date < ?" if start else ""
    params: list[str] = []
    if start and end:
        # The date window is used by two attendance subqueries, one violation
        # subquery, and two exam subqueries, in the same order as the SQL below.
        params.extend([start, end] * 5)
    query = f"""
        SELECT
            m.id, m.member_no, m.name, m.active,
            COALESCE((SELECT SUM(a.minutes) FROM attendance_records a
                WHERE a.member_id = m.id AND a.action = 'credit' {date_filter_a}), 0) AS credited_minutes,
            COALESCE((SELECT SUM(a.minutes) FROM attendance_records a
                WHERE a.member_id = m.id AND a.action = 'deduction' {date_filter_a}), 0) AS attendance_deduction_minutes,
            COALESCE((SELECT SUM(v.deducted_minutes) FROM violations v
                WHERE v.member_id = m.id {date_filter_v}), 0) AS violation_deduction_minutes,
            (SELECT AVG(e.score) FROM exam_scores e
                WHERE e.member_id = m.id {date_filter_e}) AS average_score,
            (SELECT COUNT(*) FROM exam_scores e
                WHERE e.member_id = m.id {date_filter_e}) AS exam_count
        FROM members m
        WHERE m.active = 1
        ORDER BY m.member_no COLLATE NOCASE
    """
    rows = []
    for row in db.execute(query, params).fetchall():
        item = dict(row)
        total_deduction = (
            item["attendance_deduction_minutes"] + item["violation_deduction_minutes"]
        )
        item["deducted_minutes"] = total_deduction
        item["net_minutes"] = max(0, item["credited_minutes"] - total_deduction)
        rows.append(item)
    return rows


@app.get("/api/analytics/ranking")
def ranking(_: AuthToken, month: str | None = None) -> dict:
    start = end = None
    if month:
        try:
            start, end = month_bounds(month)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    with connect() as db:
        members = analytics_rows(db, start, end)
    members.sort(key=lambda item: (-item["net_minutes"], item["member_no"].lower()))
    for index, member in enumerate(members, start=1):
        member["rank"] = index
    return {"month": month, "members": members}


@app.get("/api/analytics/attendance")
def attendance_analytics(month: str, _: AuthToken) -> dict:
    try:
        start, end = month_bounds(month)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with connect() as db:
        plan = db.execute(
            "SELECT planned_minutes, note FROM training_plans WHERE month = ?", (month,)
        ).fetchone()
        planned_minutes = plan["planned_minutes"] if plan else 0
        members = analytics_rows(db, start, end)
    for member in members:
        member["attendance_rate"] = (
            round(member["net_minutes"] / planned_minutes * 100, 1)
            if planned_minutes > 0
            else None
        )
    members.sort(key=lambda item: (-item["attendance_rate"] if item["attendance_rate"] is not None else 1, item["member_no"].lower()))
    return {
        "month": month,
        "planned_minutes": planned_minutes,
        "plan_note": plan["note"] if plan else "",
        "members": members,
    }


def current_month() -> str:
    return datetime.now().astimezone().strftime("%Y-%m")


def email_settings_public(settings: dict) -> dict:
    """Public view of the email settings — never expose the stored password."""
    return {
        "smtp_host": settings["email_smtp_host"],
        "smtp_port": int(settings["email_smtp_port"] or 465),
        "smtp_username": settings["email_smtp_username"],
        "password_set": bool(settings["email_smtp_password"]),
        "sender_name": settings["email_sender_name"],
        "from_email": settings["email_from"],
        "use_ssl": settings["email_use_ssl"] == "1",
        "auto_enabled": settings["email_auto_enabled"] == "1",
        "last_sent_month": settings["email_last_sent_month"],
    }


@app.get("/api/email/settings")
def read_email_settings(_: AuthToken) -> dict:
    with connect() as db:
        return email_settings_public(get_email_settings(db))


@app.put("/api/email/settings")
def update_email_settings(payload: EmailSettingsUpdate, _: AuthToken) -> dict:
    values = {
        "email_smtp_host": payload.smtp_host,
        "email_smtp_port": str(payload.smtp_port),
        "email_smtp_username": payload.smtp_username,
        "email_sender_name": payload.sender_name,
        "email_from": payload.from_email,
        "email_use_ssl": "1" if payload.use_ssl else "0",
        "email_auto_enabled": "1" if payload.auto_enabled else "0",
    }
    # Only overwrite the password when a new non-empty value is supplied.
    if payload.smtp_password:
        values["email_smtp_password"] = payload.smtp_password
    with connect() as db:
        set_email_settings(db, values)
        return email_settings_public(get_email_settings(db))


@app.post("/api/email/test")
def send_test_email(payload: EmailTestRequest, _: AuthToken) -> dict:
    with connect() as db:
        settings = get_email_settings(db)
    try:
        sender_name = settings["email_sender_name"].strip() or "RollCall"
        html = (
            "<div style='font-family:sans-serif;color:#1b322c'>"
            "<h2>邮件配置测试成功 ✅</h2>"
            f"<p>这是一封来自「{sender_name}」的测试邮件，说明 SMTP 配置可用。</p></div>"
        )
        email_service.send_email(settings, payload.to_email, f"【{sender_name}】邮件配置测试", html)
    except email_service.EmailConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface SMTP errors to the client
        raise HTTPException(status_code=502, detail=f"发送失败：{exc}") from exc
    return {"message": f"测试邮件已发送至 {payload.to_email}"}


@app.post("/api/email/send")
def send_reports(payload: EmailSendRequest, _: AuthToken) -> dict:
    month = payload.month or current_month()
    with connect() as db:
        settings = get_email_settings(db)
        if not settings["email_smtp_host"] or not (settings["email_from"] or settings["email_smtp_username"]):
            raise HTTPException(status_code=400, detail="尚未配置 SMTP 服务器或发件邮箱，请先在邮件设置中填写")
        summary = email_service.send_monthly_reports(db, month, payload.member_ids)
    return summary


@app.get("/api/email/logs")
def list_email_logs(_: AuthToken, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM email_logs ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(row) for row in rows]


async def auto_push_scheduler() -> None:
    """Background loop: on the last day of the month, auto-send reports once.

    Only runs while the app is up. Checks hourly and de-duplicates via the
    stored ``email_last_sent_month`` marker so it fires at most once per month.
    """
    while True:
        try:
            today = datetime.now().astimezone().date()
            last_day = calendar.monthrange(today.year, today.month)[1]
            month = today.strftime("%Y-%m")
            with connect() as db:
                settings = get_email_settings(db)
                should_send = (
                    today.day == last_day
                    and settings["email_auto_enabled"] == "1"
                    and settings["email_last_sent_month"] != month
                    and bool(settings["email_smtp_host"])
                )
                if should_send:
                    await asyncio.to_thread(email_service.send_monthly_reports, db, month)
                    set_email_settings(db, {"email_last_sent_month": month})
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - never let the scheduler crash the loop
            pass
        await asyncio.sleep(3600)

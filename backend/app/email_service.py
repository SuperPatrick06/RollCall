from __future__ import annotations

import smtplib
import sqlite3
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

from .database import get_email_settings, now_iso


class EmailConfigError(Exception):
    """Raised when the SMTP configuration is incomplete."""


def _month_bounds(month: str) -> tuple[str, str]:
    start = date.fromisoformat(f"{month}-01")
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start.isoformat(), end.isoformat()


def _next_month(month: str) -> str:
    start = date.fromisoformat(f"{month}-01")
    nxt = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return nxt.strftime("%Y-%m")


def _format_hours(minutes: int | float | None) -> str:
    return f"{(minutes or 0) / 60:.1f} 小时"


def _scalar(db: sqlite3.Connection, query: str, params: tuple) -> int:
    row = db.execute(query, params).fetchone()
    return row[0] if row and row[0] is not None else 0


def _net_minutes(db: sqlite3.Connection, member_id: int, start: str | None, end: str | None) -> dict:
    """Credited / deducted / net training minutes, optionally within [start, end)."""
    att_filter = "AND training_date >= ? AND training_date < ?" if start else ""
    viol_filter = "AND violation_date >= ? AND violation_date < ?" if start else ""
    att_params = (member_id, start, end) if start else (member_id,)
    viol_params = (member_id, start, end) if start else (member_id,)

    credited = _scalar(
        db,
        f"SELECT SUM(minutes) FROM attendance_records WHERE member_id = ? AND action = 'credit' {att_filter}",
        att_params,
    )
    att_deduction = _scalar(
        db,
        f"SELECT SUM(minutes) FROM attendance_records WHERE member_id = ? AND action = 'deduction' {att_filter}",
        att_params,
    )
    violation_deduction = _scalar(
        db,
        f"SELECT SUM(deducted_minutes) FROM violations WHERE member_id = ? {viol_filter}",
        viol_params,
    )
    deducted = att_deduction + violation_deduction
    return {
        "credited_minutes": credited,
        "deducted_minutes": deducted,
        "net_minutes": max(0, credited - deducted),
    }


def build_member_report(db: sqlite3.Connection, member: sqlite3.Row, month: str) -> dict:
    """Assemble one member's monthly report data."""
    start, end = _month_bounds(month)

    month_stats = _net_minutes(db, member["id"], start, end)
    total_stats = _net_minutes(db, member["id"], None, None)

    violations = [
        dict(row)
        for row in db.execute(
            """
            SELECT behavior, deducted_minutes, violation_date, note FROM violations
            WHERE member_id = ? AND violation_date >= ? AND violation_date < ?
            ORDER BY violation_date DESC
            """,
            (member["id"], start, end),
        ).fetchall()
    ]

    exams = [
        dict(row)
        for row in db.execute(
            """
            SELECT exam_name, project, score, exam_date FROM exam_scores
            WHERE member_id = ? AND exam_date >= ? AND exam_date < ?
            ORDER BY exam_date DESC
            """,
            (member["id"], start, end),
        ).fetchall()
    ]

    next_month = _next_month(month)
    plan_row = db.execute(
        "SELECT planned_minutes, note FROM training_plans WHERE month = ?", (next_month,)
    ).fetchone()
    next_plan = dict(plan_row) if plan_row else None

    return {
        "month": month,
        "next_month": next_month,
        "month_stats": month_stats,
        "total_stats": total_stats,
        "violations": violations,
        "exams": exams,
        "next_plan": next_plan,
    }


def render_report_html(member: sqlite3.Row, report: dict, sender_name: str) -> str:
    """Render the monthly report as an HTML email body."""
    month = report["month"]
    name = escape(member["name"])
    member_no = escape(member["member_no"])
    month_stats = report["month_stats"]
    total_stats = report["total_stats"]

    if report["violations"]:
        violation_rows = "".join(
            f"<tr><td>{escape(v['violation_date'])}</td><td>{escape(v['behavior'])}</td>"
            f"<td style='text-align:right'>−{_format_hours(v['deducted_minutes'])}</td></tr>"
            for v in report["violations"]
        )
        violation_block = (
            "<table style='width:100%;border-collapse:collapse;font-size:14px'>"
            "<thead><tr style='color:#768589'>"
            "<th style='text-align:left;padding:4px 0'>日期</th>"
            "<th style='text-align:left;padding:4px 0'>行为</th>"
            "<th style='text-align:right;padding:4px 0'>扣除</th></tr></thead>"
            f"<tbody>{violation_rows}</tbody></table>"
        )
    else:
        violation_block = "<p style='margin:0;color:#4c9a6a'>本月无违规记录，继续保持！</p>"

    if report["exams"]:
        exam_rows = "".join(
            f"<tr><td>{escape(e['exam_date'])}</td><td>{escape(e['exam_name'])} / {escape(e['project'])}</td>"
            f"<td style='text-align:right'><strong>{e['score']:.1f}</strong></td></tr>"
            for e in report["exams"]
        )
        exam_block = (
            "<table style='width:100%;border-collapse:collapse;font-size:14px'>"
            "<thead><tr style='color:#768589'>"
            "<th style='text-align:left;padding:4px 0'>日期</th>"
            "<th style='text-align:left;padding:4px 0'>考试 / 项目</th>"
            "<th style='text-align:right;padding:4px 0'>分数</th></tr></thead>"
            f"<tbody>{exam_rows}</tbody></table>"
        )
    else:
        exam_block = "<p style='margin:0;color:#768589'>本月暂无考核记录。</p>"

    if report["next_plan"]:
        plan = report["next_plan"]
        note = escape(plan["note"]) if plan["note"] else "暂无补充说明"
        next_plan_block = (
            f"<p style='margin:0'>计划出勤时长：<strong>{_format_hours(plan['planned_minutes'])}</strong></p>"
            f"<p style='margin:6px 0 0;color:#768589'>{note}</p>"
        )
    else:
        next_plan_block = "<p style='margin:0;color:#768589'>下月计划尚未发布，请留意后续通知。</p>"

    def section(title: str, body: str) -> str:
        return (
            "<div style='margin:0 0 18px;padding:16px 18px;background:#f6f8f7;"
            "border:1px solid #e2e8e5;border-radius:10px'>"
            f"<h3 style='margin:0 0 10px;font-size:15px;color:#1b322c'>{title}</h3>{body}</div>"
        )

    stats_body = (
        "<div style='display:flex;gap:24px;flex-wrap:wrap'>"
        f"<div><div style='color:#768589;font-size:13px'>本月净出勤</div>"
        f"<div style='font-size:22px;font-weight:700;color:#1b322c'>{_format_hours(month_stats['net_minutes'])}</div></div>"
        f"<div><div style='color:#768589;font-size:13px'>累计出勤总时长</div>"
        f"<div style='font-size:22px;font-weight:700;color:#1b322c'>{_format_hours(total_stats['net_minutes'])}</div></div>"
        "</div>"
    )

    return (
        "<div style='max-width:600px;margin:0 auto;font-family:\"Segoe UI\",\"Microsoft YaHei\",sans-serif;"
        "color:#1b322c;padding:24px'>"
        f"<div style='margin-bottom:18px'>"
        f"<div style='font-size:12px;letter-spacing:2px;color:#768589'>MONTHLY REPORT · {escape(month)}</div>"
        f"<h1 style='margin:6px 0 0;font-size:22px'>{escape(sender_name)}</h1>"
        f"<p style='margin:4px 0 0;color:#768589'>{name}（{member_no}）· {escape(month)} 个人月度报告</p>"
        "</div>"
        + section("出勤时长概览", stats_body)
        + section("违规情况", violation_block)
        + section("考核成绩", exam_block)
        + section(f"{escape(report['next_month'])} 计划安排", next_plan_block)
        + f"<p style='margin:20px 0 0;color:#a0aead;font-size:12px'>本邮件由「{escape(sender_name)}」自动发送，请勿直接回复。</p>"
        "</div>"
    )


def send_email(settings: dict, to_email: str, subject: str, html_body: str) -> None:
    """Send a single HTML email using the stored SMTP settings. Raises on failure."""
    host = settings.get("email_smtp_host", "").strip()
    from_email = settings.get("email_from", "").strip() or settings.get("email_smtp_username", "").strip()
    if not host or not from_email:
        raise EmailConfigError("尚未配置 SMTP 服务器或发件邮箱，请先在邮件设置中填写")

    port = int(settings.get("email_smtp_port") or 465)
    username = settings.get("email_smtp_username", "").strip()
    password = settings.get("email_smtp_password", "")
    sender_name = settings.get("email_sender_name", "").strip() or "RollCall"
    use_ssl = str(settings.get("email_use_ssl", "1")) == "1"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((sender_name, from_email))
    message["To"] = to_email
    message.set_content("请使用支持 HTML 的邮件客户端查看本报告。")
    message.add_alternative(html_body, subtype="html")

    if use_ssl:
        server = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
    try:
        if not use_ssl:
            server.starttls()
        if username:
            server.login(username, password)
        server.send_message(message)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def send_monthly_reports(
    db: sqlite3.Connection, month: str, member_ids: list[int] | None = None
) -> dict:
    """Build and send the monthly report to every active member with an email.

    Members without an email are logged as 'skipped'. Returns a summary dict.
    """
    settings = get_email_settings(db)
    sender_name = settings.get("email_sender_name", "").strip() or "RollCall"

    query = "SELECT * FROM members WHERE active = 1"
    params: list = []
    if member_ids:
        placeholders = ",".join("?" for _ in member_ids)
        query += f" AND id IN ({placeholders})"
        params.extend(member_ids)
    query += " ORDER BY member_no COLLATE NOCASE"
    members = db.execute(query, params).fetchall()

    summary = {"month": month, "sent": 0, "skipped": 0, "failed": 0, "details": []}
    subject = f"【{sender_name}】{month} 个人月度报告"

    for member in members:
        recipient = (member["email"] or "").strip()
        if not recipient:
            _log_email(db, member["id"], "", subject, month, "skipped", "未填写邮箱")
            summary["skipped"] += 1
            summary["details"].append({"name": member["name"], "status": "skipped", "reason": "未填写邮箱"})
            continue
        try:
            report = build_member_report(db, member, month)
            html_body = render_report_html(member, report, sender_name)
            send_email(settings, recipient, subject, html_body)
        except Exception as exc:  # noqa: BLE001 - record and continue with the rest
            _log_email(db, member["id"], recipient, subject, month, "failed", str(exc))
            summary["failed"] += 1
            summary["details"].append({"name": member["name"], "status": "failed", "reason": str(exc)})
            continue
        _log_email(db, member["id"], recipient, subject, month, "sent", "")
        summary["sent"] += 1
        summary["details"].append({"name": member["name"], "status": "sent", "reason": recipient})

    return summary


def _log_email(
    db: sqlite3.Connection,
    member_id: int | None,
    recipient: str,
    subject: str,
    month: str,
    status: str,
    error: str,
) -> None:
    db.execute(
        """
        INSERT INTO email_logs(member_id, recipient, subject, month, status, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (member_id, recipient, subject, month, status, error, now_iso()),
    )

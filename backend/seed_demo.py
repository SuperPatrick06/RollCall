"""Seed the local database with demo data.

Usage:
    python seed_demo.py          # insert demo data into an empty database
    python seed_demo.py --force  # wipe existing members and re-seed

The data is entirely fictional and only meant for trying out RollCall locally.
"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta

from app.database import connect, initialize_database, now_iso

SEED = 42

MEMBERS = [
    ("A001", "陈嘉怡", "26-27", "jiayi@example.com"),
    ("A002", "李昊然", "26-27", "haoran@example.com"),
    ("A003", "王思远", "26-27", ""),
    ("A004", "赵雨桐", "25-26", "yutong@example.com"),
    ("A005", "刘子谦", "25-26", "ziqian@example.com"),
    ("A006", "周静怡", "25-26", ""),
    ("A007", "吴俊杰", "26-27", "junjie@example.com"),
    ("A008", "郑欣悦", "26-27", "xinyue@example.com"),
]


def seed(force: bool = False) -> None:
    random.seed(SEED)
    initialize_database()
    today = date.today()

    with connect() as db:
        existing = db.execute("SELECT COUNT(*) AS n FROM members").fetchone()["n"]
        if existing and not force:
            print("Database already contains members. Use --force to wipe and re-seed.")
            sys.exit(1)
        if existing:
            for table in (
                "email_logs",
                "operation_logs",
                "violations",
                "exam_scores",
                "attendance_records",
                "training_plans",
                "members",
            ):
                db.execute(f"DELETE FROM {table}")

        member_ids: dict[str, int] = {}
        for member_no, name, year, email in MEMBERS:
            cursor = db.execute(
                """
                INSERT INTO members(member_no, name, email, enrollment_year, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (member_no, name, email, year, now_iso()),
            )
            member_ids[member_no] = cursor.lastrowid

        # Monthly plans for the last three months.
        for offset in (2, 1, 0):
            month_start = (today.replace(day=1) - timedelta(days=28 * offset)).replace(day=1)
            month = month_start.strftime("%Y-%m")
            db.execute(
                """
                INSERT INTO training_plans(month, planned_minutes, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(month) DO UPDATE SET planned_minutes = excluded.planned_minutes
                """,
                (month, 1200, "每周三次常规活动", now_iso(), now_iso()),
            )

        # Attendance credits over the last 60 days, three sessions per week.
        for delta in range(60, -1, -1):
            day = today - timedelta(days=delta)
            if day.weekday() not in (1, 3, 6):  # Tue / Thu / Sun
                continue
            attendees = [m[0] for m in random.sample(MEMBERS, k=random.randint(4, 7))]
            for member_no in attendees:
                minutes = random.choice([75, 90, 105, 120, 135])
                db.execute(
                    """
                    INSERT INTO attendance_records
                        (member_id, training_date, minutes, action, note, created_at)
                    VALUES (?, ?, ?, 'credit', ?, ?)
                    """,
                    (member_ids[member_no], day.isoformat(), minutes, "", now_iso()),
                )

        # A couple of deductions and violations.
        for member_no, days_ago, minutes, note in (
            ("A003", 21, 60, "早退"),
            ("A006", 12, 30, "迟到"),
        ):
            day = (today - timedelta(days=days_ago)).isoformat()
            db.execute(
                """
                INSERT INTO attendance_records
                    (member_id, training_date, minutes, action, note, created_at)
                VALUES (?, ?, ?, 'deduction', ?, ?)
                """,
                (member_ids[member_no], day, minutes, note, now_iso()),
            )

        for member_no, days_ago, behavior, minutes in (
            ("A003", 21, "无故缺席", 60),
            ("A006", 12, "迟到", 30),
            ("A002", 5, "未按要求着装", 30),
        ):
            day = (today - timedelta(days=days_ago)).isoformat()
            db.execute(
                """
                INSERT INTO violations
                    (member_id, behavior, deducted_minutes, violation_date, note, created_at)
                VALUES (?, ?, ?, ?, '', ?)
                """,
                (member_ids[member_no], behavior, minutes, day, now_iso()),
            )

        # Exams in the previous month and this month.
        for exam_name, days_ago, project in (
            ("月度考核", 35, "理论测试"),
            ("月度考核", 35, "实操项目"),
            ("期中考核", 10, "理论测试"),
        ):
            for member_no in [m[0] for m in random.sample(MEMBERS, k=6)]:
                day = (today - timedelta(days=days_ago)).isoformat()
                db.execute(
                    """
                    INSERT INTO exam_scores
                        (exam_name, member_id, project, score, exam_date, note, created_at)
                    VALUES (?, ?, ?, ?, ?, '', ?)
                    """,
                    (
                        exam_name,
                        member_ids[member_no],
                        project,
                        round(random.uniform(68, 98), 1),
                        day,
                        now_iso(),
                    ),
                )

    print("Demo data inserted. Start the app and log in with the default password.")


if __name__ == "__main__":
    seed(force="--force" in sys.argv)

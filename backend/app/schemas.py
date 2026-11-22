from __future__ import annotations

import re
from datetime import date

from pydantic import BaseModel, Field, field_validator


MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str | None) -> str:
    """Trim an email and validate its shape; empty string means 'no email'."""
    if value is None:
        return ""
    value = value.strip()
    if value and not EMAIL_PATTERN.fullmatch(value):
        raise ValueError("邮箱格式不正确")
    return value


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)


class MemberCreate(BaseModel):
    member_no: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=50)
    email: str = Field(default="", max_length=120)
    enrollment_year: str = Field(default="", max_length=20)

    @field_validator("member_no", "name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("内容不能为空")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("enrollment_year")
    @classmethod
    def strip_year(cls, value: str) -> str:
        return value.strip()


class MemberUpdate(BaseModel):
    member_no: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=50)
    email: str | None = Field(default=None, max_length=120)
    enrollment_year: str | None = Field(default=None, max_length=20)
    active: bool | None = None

    @field_validator("enrollment_year")
    @classmethod
    def strip_optional_year(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("member_no", "name")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("内容不能为空")
        return value

    @field_validator("email")
    @classmethod
    def validate_optional_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_email(value)


class AttendanceCreate(BaseModel):
    member_no: str = Field(min_length=1, max_length=32)
    training_date: date
    minutes: int = Field(ge=15, le=24 * 60)
    action: str
    note: str = Field(default="", max_length=200)

    @field_validator("member_no", "note")
    @classmethod
    def strip_attendance_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        if value not in {"credit", "deduction"}:
            raise ValueError("action 必须是 credit 或 deduction")
        return value


class TrainingPlanUpsert(BaseModel):
    planned_minutes: int = Field(ge=0, le=31 * 24 * 60)
    note: str = Field(default="", max_length=200)


class ExamCreate(BaseModel):
    exam_name: str = Field(min_length=1, max_length=80)
    member_no: str = Field(min_length=1, max_length=32)
    project: str = Field(min_length=1, max_length=80)
    score: float = Field(ge=0, le=100)
    exam_date: date
    note: str = Field(default="", max_length=200)

    @field_validator("exam_name", "member_no", "project", "note")
    @classmethod
    def strip_exam_text(cls, value: str) -> str:
        return value.strip()


class ViolationCreate(BaseModel):
    member_no: str = Field(min_length=1, max_length=32)
    behavior: str = Field(min_length=1, max_length=120)
    deducted_minutes: int = Field(ge=15, le=24 * 60)
    violation_date: date
    note: str = Field(default="", max_length=200)

    @field_validator("member_no", "behavior", "note")
    @classmethod
    def strip_violation_text(cls, value: str) -> str:
        return value.strip()


class EmailSettingsUpdate(BaseModel):
    smtp_host: str = Field(default="", max_length=200)
    smtp_port: int = Field(default=465, ge=1, le=65535)
    smtp_username: str = Field(default="", max_length=200)
    # Optional: only overwrite the stored password when a non-empty value is sent.
    smtp_password: str | None = Field(default=None, max_length=200)
    sender_name: str = Field(default="RollCall", max_length=100)
    from_email: str = Field(default="", max_length=120)
    use_ssl: bool = True
    auto_enabled: bool = False

    @field_validator("smtp_host", "smtp_username", "sender_name")
    @classmethod
    def strip_settings_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("from_email")
    @classmethod
    def validate_from_email(cls, value: str) -> str:
        return normalize_email(value)


class EmailTestRequest(BaseModel):
    to_email: str = Field(min_length=1, max_length=120)

    @field_validator("to_email")
    @classmethod
    def validate_to_email(cls, value: str) -> str:
        email = normalize_email(value)
        if not email:
            raise ValueError("请填写收件邮箱")
        return email


class EmailSendRequest(BaseModel):
    month: str | None = None
    member_ids: list[int] | None = None

    @field_validator("month")
    @classmethod
    def validate_optional_month(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_month(value)


def validate_month(month: str) -> str:
    if not MONTH_PATTERN.fullmatch(month):
        raise ValueError("月份格式必须为 YYYY-MM")
    return month

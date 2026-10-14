from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PASSWORD_MIN = 10
PASSWORD_MAX = 128


def _check_password(value: str) -> str:
    if len(value) < PASSWORD_MIN or len(value) > PASSWORD_MAX:
        raise ValueError(f"password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters")
    if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError("password must contain letters and digits")
    return value


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _check_password(v)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=PASSWORD_MAX)


class EmailIn(BaseModel):
    email: EmailStr


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _check_password(v)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=PASSWORD_MAX)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return _check_password(v)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    avatar_url: str | None = Field(default=None, max_length=500)


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=PASSWORD_MAX)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: str
    role: str
    plan: str
    email_verified: bool
    is_blocked: bool
    credit_balance: int
    avatar_url: str | None
    created_at: datetime


class AuthOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserOut


class RegisterOut(BaseModel):
    user: UserOut
    verification_required: bool
    email_delivery: Literal["sent", "not_connected"]


class SessionOut(BaseModel):
    id: str
    user_agent: str | None
    ip: str | None
    created_at: datetime
    expires_at: datetime
    current: bool = False


class ProjectCreateIn(BaseModel):
    name: str = Field(default="Untitled project", min_length=1, max_length=200)
    folder: str = Field(default="Default", min_length=1, max_length=120)


class ProjectPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    folder: str | None = Field(default=None, min_length=1, max_length=120)


class ProjectOut(BaseModel):
    id: str
    name: str
    folder: str
    version: int
    created_at: datetime
    updated_at: datetime


class ProjectDetailOut(ProjectOut):
    document: dict[str, Any]


class DocumentSaveIn(BaseModel):
    document: dict[str, Any]
    base_version: int = Field(ge=1)


class DocumentSaveOut(BaseModel):
    version: int
    updated_at: datetime


class VersionOut(BaseModel):
    version: int
    created_at: datetime
    created_by: str


class AdminUserPatch(BaseModel):
    role: Literal["user", "admin"] | None = None
    plan: Literal["free", "pro", "studio"] | None = None


class AdminBlockIn(BaseModel):
    blocked: bool
    reason: str | None = Field(default=None, max_length=300)


class AdminCreditsIn(BaseModel):
    delta: int = Field(ge=-1_000_000, le=1_000_000)
    reason: str = Field(min_length=3, max_length=200)


class AIEstimateIn(BaseModel):
    provider: Literal["openai", "meshy", "tripo", "stability", "video", "audio"]
    task: str = Field(min_length=1, max_length=60)
    units: int = Field(default=1, ge=1, le=100)


class AIRunIn(AIEstimateIn):
    prompt: str = Field(min_length=1, max_length=4000)
    project_id: str | None = None
    confirmed: bool = False

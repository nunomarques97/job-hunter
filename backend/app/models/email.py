"""Email accounts, messages and templates.

Credentials are never stored here. An account row records which mechanism is in
use and where the secret lives, and the secret itself stays in the operating
system credential store or an environment variable. No column in this module
ever receives a password or a refresh token.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import TimestampedBase


class EmailAccount(TimestampedBase):
    __tablename__ = "email_accounts"

    address: Mapped[str] = mapped_column(String(320), index=True)
    display_name: Mapped[str] = mapped_column(String(200), default="")
    #: "gmail_oauth" or "smtp".
    provider: Mapped[str] = mapped_column(String(30), default="smtp")

    smtp_host: Mapped[str] = mapped_column(String(200), default="")
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    imap_host: Mapped[str] = mapped_column(String(200), default="")
    imap_port: Mapped[int] = mapped_column(Integer, default=993)

    #: Name of the entry in the OS credential store, never the secret itself.
    credential_ref: Mapped[str] = mapped_column(String(200), default="")
    oauth_scopes: Mapped[list[str]] = mapped_column(JSON, default=list)

    is_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(String(500), default="")


class EmailMessage(TimestampedBase):
    __tablename__ = "email_messages"

    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("email_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    application_id: Mapped[int | None] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), nullable=True, index=True
    )

    #: "inbox", "sent" or "draft".
    folder: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    #: "draft", "queued", "sent" or "failed".
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)

    message_id: Mapped[str] = mapped_column(String(400), default="", index=True)
    thread_id: Mapped[str] = mapped_column(String(400), default="", index=True)

    from_address: Mapped[str] = mapped_column(String(320), default="")
    to_addresses: Mapped[list[str]] = mapped_column(JSON, default=list)
    cc_addresses: Mapped[list[str]] = mapped_column(JSON, default=list)
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    is_html: Mapped[bool] = mapped_column(Boolean, default=False)
    attachments: Mapped[list[dict]] = mapped_column(JSON, default=list)

    #: Classification of an inbound message: "rejection", "interview",
    #: "acknowledgement", "offer", "other".
    classification: Mapped[str] = mapped_column(String(30), default="", index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class EmailTemplate(TimestampedBase):
    __tablename__ = "email_templates"

    name: Mapped[str] = mapped_column(String(200), index=True)
    #: "follow_up", "thank_you", "withdrawal", "recruiter_outreach", "custom".
    category: Mapped[str] = mapped_column(String(40), default="custom", index=True)
    subject: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    #: Placeholder names the body may use, for example {company} or {role}.
    variables: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)

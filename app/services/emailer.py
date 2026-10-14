"""Email adapter: SMTP when configured, otherwise honest console/dev outbox.

The app never pretends an email was sent:
- SMTP configured -> real delivery, result recorded in outbox table.
- Not configured  -> message stored as undelivered; in DEBUG the link is
  returned to the caller so a developer can proceed; in production the API
  reports that email delivery is not configured.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.text import MIMEText

from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..models import OutboxEmail

log = logging.getLogger("zyvora.email")


class EmailResult:
    def __init__(self, delivered: bool, dev_link: str | None = None, error: str | None = None):
        self.delivered = delivered
        self.dev_link = dev_link
        self.error = error


def smtp_configured() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.smtp_from)


def send_email(db: DbSession, to_email: str, subject: str, body: str, *, dev_link: str | None = None) -> EmailResult:
    s = get_settings()
    record = OutboxEmail(to_email=to_email[:250], subject=subject[:250], body=body)
    db.add(record)
    if not smtp_configured():
        record.delivered = False
        record.error = "SMTP not configured"
        db.commit()
        log.warning("Email not delivered (SMTP not configured): to=%s subject=%s", to_email, subject)
        if s.debug:
            return EmailResult(delivered=False, dev_link=dev_link)
        return EmailResult(delivered=False, error="email_not_configured")
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = s.smtp_from
        msg["To"] = to_email
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as server:
            if s.smtp_tls:
                server.starttls()
            if s.smtp_user:
                server.login(s.smtp_user, s.smtp_password)
            server.sendmail(s.smtp_from, [to_email], msg.as_string())
        record.delivered = True
        db.commit()
        return EmailResult(delivered=True)
    except Exception as exc:  # noqa: BLE001
        record.error = str(exc)[:500]
        db.commit()
        log.error("SMTP delivery failed: %s", exc)
        return EmailResult(delivered=False, error="smtp_error")

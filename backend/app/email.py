"""Email delivery adapter. Sending is only real when SMTP is configured.

No SMTP settings exist yet in this build, so messages are NOT delivered and
`send_email` returns False. Callers must not claim an email was sent.
"""

import logging

log = logging.getLogger("zyvora.email")


def email_status() -> dict:
    return {"provider": "smtp", "connected": False, "reason": "SMTP is not configured"}


def send_email(to: str, subject: str, body: str) -> bool:
    if not email_status()["connected"]:
        log.warning("email not sent (provider not connected): %s -> %s", subject, to)
        return False
    return False

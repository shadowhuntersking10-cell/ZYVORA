import os, hmac, hashlib
class PaymentsNotConnected(Exception): pass
def stripe_configured(): return bool(os.getenv("STRIPE_SECRET_KEY") and os.getenv("STRIPE_WEBHOOK_SECRET"))
def verify_stripe_signature(payload: bytes, sig_header: str, secret: str, tolerance: int = 300) -> bool:
    """Verify Stripe webhook signature (t=...,v1=...) in constant time."""
    if not secret: raise PaymentsNotConnected("Payments not connected")
    try:
        parts = dict(p.split("=",1) for p in sig_header.split(","))
        signed = f"{parts['t']}.".encode() + payload
        expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, parts.get("v1",""))
    except Exception: return False

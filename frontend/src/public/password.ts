export interface PasswordCheck {
  length: boolean;
  caseMix: boolean;
  digit: boolean;
}

/** The rules the backend enforces (see backend/app/schemas.py::_check_password). */
export function checkPassword(pw: string): PasswordCheck {
  return {
    length: pw.length >= 8 && pw.length <= 128,
    caseMix: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
  };
}

export function isValidPassword(pw: string): boolean {
  const c = checkPassword(pw);
  return c.length && c.caseMix && c.digit;
}

/** 0 (empty) to 4 (strong). Strength goes beyond the hard rules: length and symbols add points. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  const c = checkPassword(pw);
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (c.caseMix) score += 1;
  if (c.digit) score += 1;
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) score += 1;
  // Below 8 characters the password can never be "Good" or better.
  if (pw.length < 8) return score >= 1 ? 1 : 0;
  return Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

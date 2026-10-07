// Field rules shared by the auth forms. They mirror the API's validation (brief, section 5).

export const validateName = (name) => {
  const v = name.trim();
  if (v.length < 2) return 'Name must be at least 2 characters';
  if (v.length > 50) return 'Name must be at most 50 characters';
  return null;
};

export const validateEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address';

// Optional; accepts 03XXXXXXXXX or +923XXXXXXXXX (spaces and dashes allowed)
export const validatePhone = (phone) => {
  const v = phone.replace(/[\s-]/g, '');
  if (!v) return null;
  const normalized = v.startsWith('03') ? `+92${v.slice(1)}` : v;
  return /^\+923\d{9}$/.test(normalized) ? null : 'Phone must be a Pakistani mobile number (+923XXXXXXXXX)';
};

// Same rule as the API (apps/api/src/config/auth.js PASSWORD_RULES)
export const PASSWORD_RULES = [
  { test: (v) => v.length >= 8, label: 'At least 8 characters', message: 'Password must be at least 8 characters' },
  { test: (v) => /[A-Z]/.test(v), label: 'An uppercase letter', message: 'Password must contain at least 1 uppercase letter' },
  { test: (v) => /\d/.test(v), label: 'A number', message: 'Password must contain at least 1 number' },
  { test: (v) => /[^A-Za-z0-9\s]/.test(v), label: 'A special character (@ # $ % !)', message: 'Password must contain at least 1 special character (e.g. @ # $ % !)' },
];
export const PASSWORD_HINT = '8+ chars, A-Z, number & symbol';

export const validatePassword = (password) => PASSWORD_RULES.find((r) => !r.test(password || ''))?.message || null;

export const validateOtp = (code) => (/^\d{6}$/.test(code) ? null : 'Enter all 6 digits of the code');

/** Returns the first error message from a list of [error | null], or null. */
export const firstError = (...errors) => errors.find(Boolean) || null;

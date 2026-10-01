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

export const validatePassword = (password) => {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(password)) return 'Password must contain at least 1 letter';
  if (!/\d/.test(password)) return 'Password must contain at least 1 number';
  return null;
};

export const validateOtp = (code) => (/^\d{6}$/.test(code) ? null : 'Enter all 6 digits of the code');

/** Returns the first error message from a list of [error | null], or null. */
export const firstError = (...errors) => errors.find(Boolean) || null;

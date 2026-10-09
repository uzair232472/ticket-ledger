// Field rules shared by the auth forms. They mirror the API's validation (brief, section 5).

// Letters with single spaces between words, e.g. "Tariq Mehmood"
export const NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

export const validateName = (name) => {
  const v = name.trim();
  if (!v) return 'Enter your full name';
  if (/[^A-Za-z\s]/.test(v)) return 'Name can contain letters and spaces only';
  if (!NAME_PATTERN.test(v)) return 'Use a single space between words';
  if (v.length < 2) return 'Name must be at least 2 characters';
  if (v.length > 50) return 'Name must be at most 50 characters';
  return null;
};

// Loose shape check, used where existing accounts sign in (login, password reset, staff invites)
export const validateEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address';

// New accounts must use a well-known email provider. Same list as the API (apps/api/src/config/auth.js)
export const SIGNUP_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com',
  'aol.com', 'protonmail.com', 'proton.me', 'zoho.com',
];
const EMAIL_LOCAL_PATTERN = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/;

// Edit distance, used to suggest "gmail.com" for typos like "gmial.com"
const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
};

export const validateSignupEmail = (email) => {
  const v = email.trim().toLowerCase();
  if (!v) return 'Enter your email address';
  if (/\s/.test(v)) return 'Email cannot contain spaces';
  const parts = v.split('@');
  if (parts.length !== 2) return parts.length < 2 ? 'Email must contain @' : 'Email can contain only one @';
  const [local, domain] = parts;
  if (!local) return 'Enter the part before @';
  if (!EMAIL_LOCAL_PATTERN.test(local)) return 'Use letters, numbers and . _ + - before @ (not at the start or end)';
  if (local.length > 64) return 'The part before @ is too long';
  if (!domain) return 'Enter the email provider after @, e.g. gmail.com';
  if (!SIGNUP_EMAIL_DOMAINS.includes(domain)) {
    const suggestion = SIGNUP_EMAIL_DOMAINS.find((d) => distance(domain, d) <= Math.min(2, Math.floor((d.length - 1) / 3)));
    return suggestion
      ? `Did you mean ${local}@${suggestion}?`
      : 'Use an email from a known provider (Gmail, Yahoo, Outlook, Hotmail, iCloud...)';
  }
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const username = local.split('+')[0];
    if (!/^[a-z0-9.]+$/.test(username)) return 'Gmail addresses use only letters, numbers and dots';
    if (username.length < 6 || username.length > 30) return 'Gmail usernames are 6 to 30 characters long';
  }
  return null;
};

// Pakistani mobile: 03XXXXXXXXX or +92 3XX XXXXXXX (spaces and dashes allowed), operator codes 030-034 and 0355
export const PK_MOBILE_PATTERN = /^\+923(?:[0-4]\d|55)\d{7}$/;

export const validatePhone = (phone) => {
  const v = phone.replace(/[\s-]/g, '');
  if (!v) return null;
  if (/[^\d+]/.test(v) || v.lastIndexOf('+') > 0) return 'Phone number can contain digits only (an optional + at the start)';
  const normalized = v.startsWith('03') ? `+92${v.slice(1)}` : v.startsWith('923') ? `+${v}` : v;
  if (!normalized.startsWith('+923')) return 'Pakistani mobile numbers start with 03 or +92 3';
  const digits = normalized.length - 1; // without the +
  if (digits < 12) return `Number is too short: ${12 - digits} digit${12 - digits === 1 ? '' : 's'} missing (e.g. 0300 1234567)`;
  if (digits > 12) return 'Number is too long: use 11 digits like 0300 1234567';
  return PK_MOBILE_PATTERN.test(normalized) ? null : 'Not a valid Pakistani mobile operator code (030x-034x, 0355)';
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

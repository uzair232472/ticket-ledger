import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, ArrowRight } from 'lucide-react';
import AuthShell, { Alert, Field, SubmitButton } from '../components/auth/AuthShell';
import { validateEmail } from '../lib/validation';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState(location.state?.email || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const invalid = validateEmail(email);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const data = await forgotPassword(email.trim());
      // Same message whether or not the account exists
      navigate('/reset-password', { state: { email: email.trim().toLowerCase(), notice: data.message } });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your account email and we'll send you a 6-digit reset code."
      footer={
        <Link to="/login" className="text-[#16a34a] hover:underline font-bold">
          ← Back to sign in
        </Link>
      }
    >
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field
          label="Email Address"
          icon={Mail}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@gmail.com"
        />
        <SubmitButton loading={loading} loadingText="Sending code..." disabled={!email}>
          <span>Send Reset Code</span>
          <ArrowRight className="w-4 h-4" />
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

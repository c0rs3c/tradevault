'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({ nextPath }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Login failed');
      }

      router.replace(nextPath || '/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
      <form onSubmit={onSubmit} className="surface-card w-full space-y-4 p-6">
        <h1 className="text-xl font-semibold">Login</h1>

        <label className="block space-y-1">
          <span className="text-sm">Username</span>
          <input
            className="field-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Password</span>
          <input
            type="password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}


'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COLORS, STYLES } from '@/lib/colors';
import type { ReviewerIdentity } from '@/app/reviewer/types';

export default function HomePage() {
  const [reviewerInput, setReviewerInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = reviewerInput.trim();

    if (!input) {
      setError('Please enter your Reviewer ID or name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/reviewer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerInput: input }),
      });
      const result = await response.json() as { reviewer?: ReviewerIdentity; error?: string };

      if (!response.ok || !result.reviewer) {
        throw new Error(result.error || 'Reviewer ID or name not found. Please check and try again.');
      }

      localStorage.setItem('reviewerId', result.reviewer.id);
      localStorage.setItem('reviewerName', result.reviewer.name);
      router.push('/reviewer/dashboard');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'An error occurred during login. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-green-50 to-emerald-100">
      <header style={{ backgroundColor: COLORS.brand.green[800] }} className="p-4 text-white">
        <div className="container mx-auto">
          <h1 className="text-2xl font-bold">e-REC Ethics Review System</h1>
        </div>
      </header>

      <main className="flex flex-grow items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
          <div className="mb-6 text-center">
            <h1 style={STYLES.brandGreenText} className="text-2xl font-bold">e-REC Reviewer Portal</h1>
            <p className="mt-2 text-gray-600">Sign in to access your assigned protocols</p>
          </div>

          {error && <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-800">{error}</div>}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="reviewer-id" className="mb-1 block text-sm font-medium text-gray-700">
                Reviewer ID or name
              </label>
              <input
                id="reviewer-id"
                value={reviewerInput}
                onChange={(event) => setReviewerInput(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600"
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              style={STYLES.brandGreenButton}
              className="w-full rounded-md px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

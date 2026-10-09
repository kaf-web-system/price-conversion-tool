import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError('メールアドレスまたはパスワードが違います');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 font-sans">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-300 rounded-lg shadow-sm p-8 w-full max-w-sm"
      >
        <h1 className="text-lg font-bold text-center mb-6">価格改定ツール ログイン</h1>
        <label className="block mb-4">
          <span className="text-sm text-gray-600">メールアドレス</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="mt-1 w-full px-3 py-2 border border-gray-400 rounded text-sm bg-white text-black box-border"
          />
        </label>
        <label className="block mb-4">
          <span className="text-sm text-gray-600">パスワード</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 w-full px-3 py-2 border border-gray-400 rounded text-sm bg-white text-black box-border"
          />
        </label>
        {error && (
          <p className="text-red-600 text-sm mb-4">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 bg-[#0070f3] text-white font-semibold rounded border-0 cursor-pointer disabled:bg-gray-400 disabled:cursor-wait"
        >
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}

import { useState } from 'react';
import { Lock, User, AlertTriangle } from 'lucide-react';
import logoImg from '@/assets/logo.png';

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export default function LoginPage({ onLogin, isLoading = false, error }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      return;
    }
    await onLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-ash flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center">
            <img src={logoImg} alt="PyroAnnotator Logo" className="w-20 h-20 object-contain" />
          </div>
          <h2 className="mt-6 font-display text-[27px] font-semibold tracking-tight text-char">
            Sign in to PyroAnnotator
          </h2>
          <p className="mt-2 font-body text-[13.5px] text-haze">
            Classify and localize wildfire smoke from Pyronear cameras.
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-paper rounded-[10px] border border-line p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="bg-signal-soft rounded-lg p-4">
                <div className="flex items-center">
                  <AlertTriangle className="w-4 h-4 text-signal mr-2" />
                  <span className="text-sm text-signal">{error}</span>
                </div>
              </div>
            )}

            {/* Username Field */}
            <div>
              <label
                htmlFor="username"
                className="block font-body text-sm font-medium text-char mb-2"
              >
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-haze" />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 font-body border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-ember focus:border-ember transition-colors"
                  placeholder="Enter your username"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block font-body text-sm font-medium text-char mb-2"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-haze" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-12 py-3 font-body border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-ember focus:border-ember transition-colors"
                  placeholder="Enter your password"
                  disabled={isLoading}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <button
                    type="button"
                    className="text-haze hover:text-char focus:outline-none"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Sign in button */}
            <div>
              <button
                type="submit"
                disabled={isLoading || !username.trim() || !password.trim()}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent font-body text-sm font-semibold rounded-lg text-white bg-ember hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-char disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center">
                    <div className="animate-spin -ml-1 mr-3 h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                    Signing in...
                  </div>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="font-data text-[10.5px] font-medium uppercase tracking-[0.14em] text-haze">
            Pyronear
          </p>
        </div>
      </div>
    </div>
  );
}

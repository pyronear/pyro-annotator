import { useState, useEffect } from 'react';
import { Eye, EyeOff, RefreshCw, Copy, Check } from 'lucide-react';
import { generatePassword, validatePassword, PasswordStrength } from '@/utils/passwordUtils';

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  showGenerator?: boolean;
  showStrengthIndicator?: boolean;
  showRequirements?: boolean;
  className?: string;
  error?: string;
}

export default function PasswordField({
  value,
  onChange,
  label = 'Password',
  placeholder = '',
  required = false,
  showGenerator = true,
  showStrengthIndicator = true,
  showRequirements = false,
  className = '',
  error,
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (value) {
      setStrength(validatePassword(value));
    } else {
      setStrength(null);
    }
  }, [value]);

  const handleGeneratePassword = () => {
    const generatedPassword = generatePassword({
      length: 12,
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSymbols: true,
    });
    onChange(generatedPassword);
  };

  const handleCopyPassword = async () => {
    if (value) {
      try {
        await navigator.clipboard.writeText(value);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        console.error('Failed to copy password:', err);
      }
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={8}
          className={`w-full pl-3 pr-20 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            error ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : ''
          }`}
        />

        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-1">
          {showGenerator && (
            <button
              type="button"
              onClick={handleGeneratePassword}
              className="p-1 text-gray-400 hover:text-blue-600 focus:outline-none focus:text-blue-600"
              title="Generate password"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {value && (
            <button
              type="button"
              onClick={handleCopyPassword}
              className="p-1 text-gray-400 hover:text-green-600 focus:outline-none focus:text-green-600"
              title="Copy password"
            >
              {copySuccess ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600"
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Password strength indicator */}
      {showStrengthIndicator && strength && value && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Password Strength:</span>
            <span
              className={`text-xs font-medium ${
                strength.score >= 3
                  ? 'text-green-600'
                  : strength.score >= 2
                    ? 'text-yellow-600'
                    : 'text-red-600'
              }`}
            >
              {strength.label}
            </span>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${strength.color}`}
              style={{ width: `${(strength.score / 4) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Requirements checklist */}
      {showRequirements && strength && value && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">Password requirements:</p>
          <div className="space-y-1">
            <div
              className={`flex items-center text-xs ${
                strength.requirements.minLength ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              <span className={`mr-2 ${strength.requirements.minLength ? '✓' : '×'}`}>
                {strength.requirements.minLength ? '✓' : '×'}
              </span>
              At least 8 characters
            </div>
            <div
              className={`flex items-center text-xs ${
                strength.requirements.hasUppercase ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              <span className={`mr-2 ${strength.requirements.hasUppercase ? '✓' : '×'}`}>
                {strength.requirements.hasUppercase ? '✓' : '×'}
              </span>
              Uppercase letters (A-Z)
            </div>
            <div
              className={`flex items-center text-xs ${
                strength.requirements.hasLowercase ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              <span className={`mr-2 ${strength.requirements.hasLowercase ? '✓' : '×'}`}>
                {strength.requirements.hasLowercase ? '✓' : '×'}
              </span>
              Lowercase letters (a-z)
            </div>
            <div
              className={`flex items-center text-xs ${
                strength.requirements.hasNumbers ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              <span className={`mr-2 ${strength.requirements.hasNumbers ? '✓' : '×'}`}>
                {strength.requirements.hasNumbers ? '✓' : '×'}
              </span>
              Numbers (0-9)
            </div>
            <div
              className={`flex items-center text-xs ${
                strength.requirements.hasSymbols ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              <span className={`mr-2 ${strength.requirements.hasSymbols ? '✓' : '×'}`}>
                {strength.requirements.hasSymbols ? '✓' : '×'}
              </span>
              Symbols (!@#$%^&*)
            </div>
          </div>
        </div>
      )}

      {/* Basic help text when no password is entered */}
      {!value && !error && (
        <p className="text-xs text-gray-500">
          Minimum 8 characters required
          {showGenerator && '. Click the refresh button to generate a secure password.'}
        </p>
      )}
    </div>
  );
}

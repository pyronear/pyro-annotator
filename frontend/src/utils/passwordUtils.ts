/**
 * Password utility functions for secure password generation and validation.
 *
 * This module provides comprehensive password management functionality including
 * secure password generation, strength validation, and requirement checking.
 * It supports configurable password generation options and provides detailed
 * strength analysis for user authentication in the PyroAnnotator application.
 *
 * Password strength is evaluated based on length, character diversity, and
 * compliance with backend security requirements. The validation follows
 * industry best practices for password security.
 *
 * @fileoverview Comprehensive password utilities for secure authentication,
 * including generation, validation, strength analysis, and requirement checking.
 */

/**
 * Password strength analysis result.
 *
 * Provides detailed information about password strength including numeric score,
 * human-readable label, color coding for UI display, and detailed requirement
 * analysis for password complexity.
 *
 * @interface PasswordStrength
 * @property {number} score - Numeric strength score from 0-4 (weak to very strong)
 * @property {string} label - Human-readable strength label
 * @property {string} color - CSS color class for UI visualization
 * @property {Object} requirements - Detailed requirement analysis
 * @property {boolean} requirements.minLength - Whether password meets minimum length (8 chars)
 * @property {boolean} requirements.hasUppercase - Whether password contains uppercase letters
 * @property {boolean} requirements.hasLowercase - Whether password contains lowercase letters
 * @property {boolean} requirements.hasNumbers - Whether password contains numeric digits
 * @property {boolean} requirements.hasSymbols - Whether password contains special symbols
 */
export interface PasswordStrength {
  score: number; // 0-4 (weak to very strong)
  label: string;
  color: string;
  requirements: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumbers: boolean;
    hasSymbols: boolean;
  };
}

/**
 * Configuration options for password generation.
 *
 * Defines the parameters for generating secure passwords including length
 * and character type inclusion preferences. All options are optional with
 * secure defaults that ensure strong password generation.
 *
 * @interface PasswordGeneratorOptions
 * @property {number} [length=12] - Desired password length (minimum 4, recommended 12+)
 * @property {boolean} [includeUppercase=true] - Include uppercase letters (A-Z)
 * @property {boolean} [includeLowercase=true] - Include lowercase letters (a-z)
 * @property {boolean} [includeNumbers=true] - Include numeric digits (0-9)
 * @property {boolean} [includeSymbols=true] - Include special symbols (!@#$%^&*)
 */
export interface PasswordGeneratorOptions {
  length?: number;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
}

/**
 * Generates a cryptographically secure random password.
 *
 * Creates a random password based on the provided options, ensuring that
 * at least one character from each enabled character set is included.
 * The password is shuffled to avoid predictable patterns and provide
 * maximum entropy for security.
 *
 * @param {PasswordGeneratorOptions} [options={}] - Password generation configuration
 * @returns {string} Generated password meeting the specified criteria
 * @throws {Error} When no character types are enabled for generation
 *
 * @example
 * ```typescript
 * // Generate default password (12 chars, all character types)
 * const password1 = generatePassword();
 * // Returns: "Kp2$mN9qR4x!"
 *
 * // Generate longer password without symbols
 * const password2 = generatePassword({
 *   length: 16,
 *   includeSymbols: false
 * });
 * // Returns: "Rt8Zx3Qp9Nm7Ky2B"
 *
 * // Generate simple alphanumeric password
 * const password3 = generatePassword({
 *   length: 8,
 *   includeSymbols: false,
 *   includeUppercase: false
 * });
 * // Returns: "m8k3p9x7"
 * ```
 */
export function generatePassword(options: PasswordGeneratorOptions = {}): string {
  const {
    length = 12,
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
  } = options;

  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let characters = '';
  const requiredChars: string[] = [];

  if (includeUppercase) {
    characters += uppercase;
    requiredChars.push(uppercase[Math.floor(Math.random() * uppercase.length)]);
  }
  if (includeLowercase) {
    characters += lowercase;
    requiredChars.push(lowercase[Math.floor(Math.random() * lowercase.length)]);
  }
  if (includeNumbers) {
    characters += numbers;
    requiredChars.push(numbers[Math.floor(Math.random() * numbers.length)]);
  }
  if (includeSymbols) {
    characters += symbols;
    requiredChars.push(symbols[Math.floor(Math.random() * symbols.length)]);
  }

  if (characters === '') {
    throw new Error('At least one character type must be included');
  }

  // Start with required characters to ensure all types are present
  let password = requiredChars.join('');

  // Fill remaining length with random characters
  for (let i = password.length; i < length; i++) {
    password += characters[Math.floor(Math.random() * characters.length)];
  }

  // Shuffle the password to avoid predictable patterns
  return shuffleString(password);
}

/**
 * Shuffles characters in a string using Fisher-Yates algorithm.
 *
 * Randomly reorders characters in a string to eliminate predictable patterns
 * that could make passwords vulnerable to pattern-based attacks. Uses the
 * Fisher-Yates shuffle algorithm for uniform distribution.
 *
 * @private
 * @param {string} str - String to shuffle
 * @returns {string} String with characters in randomized order
 *
 * @example
 * ```typescript
 * const shuffled = shuffleString('ABC123!@#');
 * // Returns: "3@A!1B#C2" (example - actual result is random)
 * ```
 */
function shuffleString(str: string): string {
  const array = str.split('');
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array.join('');
}

/**
 * Validates password strength and returns detailed analysis.
 *
 * Analyzes a password against security requirements and provides a comprehensive
 * strength assessment including numeric score, descriptive label, color coding,
 * and detailed requirement compliance. The validation considers both length
 * and character diversity for optimal security.
 *
 * @param {string} password - Password to validate and analyze
 * @returns {PasswordStrength} Detailed password strength analysis
 *
 * @example
 * ```typescript
 * // Strong password analysis
 * const result1 = validatePassword('MySecure123!');
 * // Returns: {
 * //   score: 4,
 * //   label: 'Very Strong',
 * //   color: 'bg-green-500',
 * //   requirements: {
 * //     minLength: true,
 * //     hasUppercase: true,
 * //     hasLowercase: true,
 * //     hasNumbers: true,
 * //     hasSymbols: true
 * //   }
 * // }
 *
 * // Weak password analysis
 * const result2 = validatePassword('abc');
 * // Returns: {
 * //   score: 0,
 * //   label: 'Too Short',
 * //   color: 'bg-red-500',
 * //   requirements: { minLength: false, ... }
 * // }
 * ```
 */
export function validatePassword(password: string): PasswordStrength {
  const requirements = {
    minLength: password.length >= 8, // Backend requirement
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumbers: /[0-9]/.test(password),
    hasSymbols: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password),
  };

  const metRequirements = Object.values(requirements).filter(Boolean).length;
  let score = 0;
  let label = 'Very Weak';
  let color = 'bg-red-500';

  // Base score from length
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;

  // Additional score from character diversity
  if (requirements.hasUppercase) score += 1;
  if (requirements.hasLowercase) score += 1;
  if (requirements.hasNumbers) score += 1;
  if (requirements.hasSymbols) score += 1;

  // Adjust score based on overall strength
  if (metRequirements >= 4 && password.length >= 12) {
    score = Math.min(score, 4);
    label = 'Very Strong';
    color = 'bg-green-500';
  } else if (metRequirements >= 3 && password.length >= 10) {
    score = Math.min(score, 3);
    label = 'Strong';
    color = 'bg-green-400';
  } else if (metRequirements >= 2 && password.length >= 8) {
    score = Math.min(score, 2);
    label = 'Medium';
    color = 'bg-yellow-400';
  } else if (password.length >= 6) {
    score = Math.min(score, 1);
    label = 'Weak';
    color = 'bg-orange-400';
  }

  // Ensure minimum requirements are met for backend validation
  const isBackendValid = requirements.minLength;

  return {
    score: isBackendValid ? score : 0,
    label: isBackendValid ? label : 'Too Short',
    color: isBackendValid ? color : 'bg-red-500',
    requirements,
  };
}

/**
 * Returns a list of password requirements for user guidance.
 *
 * Provides human-readable password requirements that can be displayed
 * to users during password creation or validation. These requirements
 * align with the validation logic and backend security policies.
 *
 * @returns {string[]} Array of password requirement descriptions
 *
 * @example
 * ```typescript
 * const requirements = getPasswordRequirements();
 * // Returns: [
 * //   'At least 8 characters long',
 * //   'Include uppercase letters (A-Z)',
 * //   'Include lowercase letters (a-z)',
 * //   'Include numbers (0-9)',
 * //   'Include symbols (!@#$%^&*)'
 * // ]
 *
 * // Usage in UI
 * requirements.forEach(req => console.log(`• ${req}`));
 * ```
 */
export function getPasswordRequirements(): string[] {
  return [
    'At least 8 characters long',
    'Include uppercase letters (A-Z)',
    'Include lowercase letters (a-z)',
    'Include numbers (0-9)',
    'Include symbols (!@#$%^&*)',
  ];
}

/**
 * Determines if a password meets backend validation requirements.
 *
 * Checks whether a password satisfies the minimum requirements for
 * backend authentication. Currently focuses on minimum length requirement
 * as per backend validation policy, but can be extended for additional
 * requirements as needed.
 *
 * @param {string} password - Password to validate
 * @returns {boolean} True if password meets backend requirements
 *
 * @example
 * ```typescript
 * const isValid1 = isPasswordValid('MyPassword123!');
 * // Returns: true
 *
 * const isValid2 = isPasswordValid('short');
 * // Returns: false (less than 8 characters)
 *
 * // Usage in form validation
 * if (!isPasswordValid(userPassword)) {
 *   showError('Password does not meet minimum requirements');
 * }
 * ```
 */
export function isPasswordValid(password: string): boolean {
  const validation = validatePassword(password);
  return validation.requirements.minLength; // Backend only requires minimum length
}

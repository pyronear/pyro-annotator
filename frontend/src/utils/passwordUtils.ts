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

export interface PasswordGeneratorOptions {
  length?: number;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
}

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

function shuffleString(str: string): string {
  const array = str.split('');
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array.join('');
}

export function validatePassword(password: string): PasswordStrength {
  const requirements = {
    minLength: password.length >= 8, // Backend requirement
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumbers: /[0-9]/.test(password),
    hasSymbols: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password),
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

export function getPasswordRequirements(): string[] {
  return [
    'At least 8 characters long',
    'Include uppercase letters (A-Z)',
    'Include lowercase letters (a-z)', 
    'Include numbers (0-9)',
    'Include symbols (!@#$%^&*)',
  ];
}

export function isPasswordValid(password: string): boolean {
  const validation = validatePassword(password);
  return validation.requirements.minLength; // Backend only requires minimum length
}
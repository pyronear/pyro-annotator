/**
 * Pure color mapping utilities for smoke type visualization
 * 
 * This module provides referentially transparent functions for mapping
 * smoke types to consistent visual styling across the application.
 */

import { SmokeType } from '@/types/api';

/**
 * CSS color classes for different elements
 */
export interface ColorClasses {
  readonly border: string;
  readonly background: string;
  readonly text: string;
  readonly hover: string;
}

/**
 * Extended color scheme with additional styling options
 */
export interface ExtendedColorScheme extends ColorClasses {
  readonly accent: string;
  readonly shadow: string;
  readonly focus: string;
}

/**
 * Badge styling configuration
 */
export interface BadgeStyle {
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly borderColor: string;
  readonly icon: string;
}

/**
 * Color palette constants for consistency
 */
export const SMOKE_TYPE_PALETTE = {
  wildfire: {
    primary: 'red-500',
    light: 'red-100',
    dark: 'red-600',
    bg: 'red-500/15'
  },
  industrial: {
    primary: 'purple-500', 
    light: 'purple-100',
    dark: 'purple-600',
    bg: 'purple-500/15'
  },
  other: {
    primary: 'blue-500',
    light: 'blue-100', 
    dark: 'blue-600',
    bg: 'blue-500/15'
  },
  default: {
    primary: 'green-500',
    light: 'green-100',
    dark: 'green-600', 
    bg: 'green-500/10'
  }
} as const;

/**
 * Maps smoke type to basic CSS color classes
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke to get colors for
 * 
 * @returns Object with border and background CSS classes
 * 
 * @example
 * const colors = getSmokeTypeColors('wildfire')
 * // Result: { border: 'border-red-500', background: 'bg-red-500/15', text: 'text-red-700', hover: 'hover:bg-red-50' }
 */
export const getSmokeTypeColors = (smokeType: SmokeType): ColorClasses => {
  const palette = SMOKE_TYPE_PALETTE[smokeType] || SMOKE_TYPE_PALETTE.default;
  
  return {
    border: `border-${palette.primary}`,
    background: `bg-${palette.bg}`,
    text: `text-${palette.dark}`,
    hover: `hover:bg-${palette.light}`
  };
};

/**
 * Maps smoke type to extended color scheme with additional styling options
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke to get extended colors for
 * 
 * @returns Extended color scheme object
 * 
 * @example
 * const scheme = getExtendedSmokeTypeColors('wildfire')
 * // Result: { border: 'border-red-500', background: 'bg-red-500/15', text: 'text-red-700', hover: 'hover:bg-red-50', accent: 'accent-red-500', shadow: 'shadow-red-200', focus: 'focus:ring-red-500' }
 */
export const getExtendedSmokeTypeColors = (smokeType: SmokeType): ExtendedColorScheme => {
  const basicColors = getSmokeTypeColors(smokeType);
  const palette = SMOKE_TYPE_PALETTE[smokeType] || SMOKE_TYPE_PALETTE.default;
  
  return {
    ...basicColors,
    accent: `accent-${palette.primary}`,
    shadow: `shadow-${palette.light}`,
    focus: `focus:ring-${palette.primary}`
  };
};

/**
 * Gets badge styling for smoke type display
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke to get badge style for
 * 
 * @returns Badge styling configuration
 * 
 * @example
 * const badge = getSmokeTypeBadge('wildfire')
 * // Result: { backgroundColor: 'bg-red-500', textColor: 'text-white', borderColor: 'border-red-600', icon: '🔥' }
 */
export const getSmokeTypeBadge = (smokeType: SmokeType): BadgeStyle => {
  const palette = SMOKE_TYPE_PALETTE[smokeType] || SMOKE_TYPE_PALETTE.default;
  
  const badges = {
    wildfire: {
      backgroundColor: `bg-${palette.primary}`,
      textColor: 'text-white',
      borderColor: `border-${palette.dark}`,
      icon: '🔥'
    },
    industrial: {
      backgroundColor: `bg-${palette.primary}`, 
      textColor: 'text-white',
      borderColor: `border-${palette.dark}`,
      icon: '🏭'
    },
    other: {
      backgroundColor: `bg-${palette.primary}`,
      textColor: 'text-white', 
      borderColor: `border-${palette.dark}`,
      icon: '💨'
    }
  } as const;
  
  return badges[smokeType] || {
    backgroundColor: `bg-${SMOKE_TYPE_PALETTE.default.primary}`,
    textColor: 'text-white',
    borderColor: `border-${SMOKE_TYPE_PALETTE.default.dark}`, 
    icon: '❓'
  };
};

/**
 * Gets smoke type display label with icon
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke to get label for
 * 
 * @returns Formatted display label with icon
 * 
 * @example
 * const label = getSmokeTypeLabel('wildfire')
 * // Result: '🔥 Wildfire'
 */
export const getSmokeTypeLabel = (smokeType: SmokeType): string => {
  const badge = getSmokeTypeBadge(smokeType);
  const capitalizedType = smokeType.charAt(0).toUpperCase() + smokeType.slice(1);
  return `${badge.icon} ${capitalizedType}`;
};

/**
 * Gets all available smoke types with their color information
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @returns Array of smoke types with color and styling information
 * 
 * @example
 * const allTypes = getAllSmokeTypeColors()
 * // Result: [
 * //   { type: 'wildfire', colors: {...}, badge: {...}, label: '🔥 Wildfire' },
 * //   { type: 'industrial', colors: {...}, badge: {...}, label: '🏭 Industrial' },
 * //   { type: 'other', colors: {...}, badge: {...}, label: '💨 Other' }
 * // ]
 */
export const getAllSmokeTypeColors = (): Array<{
  readonly type: SmokeType;
  readonly colors: ColorClasses;
  readonly badge: BadgeStyle;
  readonly label: string;
}> => {
  const smokeTypes: SmokeType[] = ['wildfire', 'industrial', 'other'];
  
  return smokeTypes.map(type => ({
    type,
    colors: getSmokeTypeColors(type),
    badge: getSmokeTypeBadge(type),
    label: getSmokeTypeLabel(type)
  }));
};

/**
 * Creates CSS class string for smoke type styling
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke
 * @param variant - Styling variant ('border' | 'background' | 'text' | 'hover')
 * @param additional - Additional CSS classes to append
 * 
 * @returns Combined CSS class string
 * 
 * @example
 * const classes = createSmokeTypeClasses('wildfire', 'border', 'rounded-lg px-2')
 * // Result: 'border-red-500 rounded-lg px-2'
 */
export const createSmokeTypeClasses = (
  smokeType: SmokeType,
  variant: keyof ColorClasses,
  additional: string = ''
): string => {
  const colors = getSmokeTypeColors(smokeType);
  const baseClass = colors[variant];
  
  return additional ? `${baseClass} ${additional}` : baseClass;
};

/**
 * Gets contrasting text color for smoke type backgrounds
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke
 * 
 * @returns CSS class for contrasting text color
 * 
 * @example
 * const textColor = getContrastingTextColor('wildfire')
 * // Result: 'text-white'
 */
export const getContrastingTextColor = (smokeType: SmokeType): string => {
  // All our smoke type colors use white text for good contrast
  return 'text-white';
};

/**
 * Determines if a smoke type should use light or dark theme
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke
 * 
 * @returns Theme variant ('light' | 'dark')
 * 
 * @example
 * const theme = getSmokeTypeTheme('wildfire')
 * // Result: 'dark'
 */
export const getSmokeTypeTheme = (smokeType: SmokeType): 'light' | 'dark' => {
  // All smoke types use dark theme for better contrast with light backgrounds
  return 'dark';
};

/**
 * Creates inline styles object for smoke type elements
 * 
 * @pure This function has no side effects and always returns the same output for the same inputs
 * 
 * @param smokeType - Type of smoke
 * @param opacity - Optional opacity value (0-1)
 * 
 * @returns React inline styles object
 * 
 * @example
 * const styles = createInlineStyles('wildfire', 0.8)
 * // Result: { backgroundColor: '#ef4444', opacity: 0.8, color: '#ffffff' }
 */
export const createInlineStyles = (
  smokeType: SmokeType,
  opacity: number = 1
): React.CSSProperties => {
  const colorMap = {
    wildfire: '#ef4444',    // red-500
    industrial: '#a855f7',  // purple-500  
    other: '#3b82f6'        // blue-500
  } as const;
  
  const backgroundColor = colorMap[smokeType] || '#22c55e'; // green-500 default
  
  return {
    backgroundColor,
    opacity,
    color: '#ffffff'
  };
};
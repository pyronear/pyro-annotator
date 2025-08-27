/**
 * Toast notification system component.
 * 
 * A comprehensive toast notification component that displays success, error, and info
 * messages with auto-dismiss functionality and user interaction support.
 * 
 * @fileoverview Provides a reusable toast notification component with configurable
 * auto-dismiss timing, different visual styles for different message types, and
 * smooth animations for show/hide transitions.
 */

import React, { useEffect } from 'react';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

/**
 * Types of toast notifications supported.
 * @typedef {'success' | 'error' | 'info'} ToastType
 */
export type ToastType = 'success' | 'error' | 'info';

/**
 * Props interface for the NotificationSystem component.
 * @interface NotificationSystemProps
 */
interface NotificationSystemProps {
  /** Whether the toast should be visible */
  showToast: boolean;
  /** The message content to display */
  toastMessage: string;
  /** The type of notification (determines styling and icon) */
  toastType: ToastType;
  /** Callback function called when the toast should be dismissed */
  onDismiss: () => void;
  /** Auto-dismiss timeout in milliseconds (default: 3000ms, 0 to disable) */
  autoDismissMs?: number;
}

/**
 * Toast notification system component.
 * 
 * Displays toast notifications with different styles based on type (success, error, info).
 * Features automatic dismissal after a configurable timeout, manual dismiss via close button,
 * and smooth slide-in/slide-out animations.
 * 
 * @param {NotificationSystemProps} props - The component props
 * @param {boolean} props.showToast - Whether the toast should be visible
 * @param {string} props.toastMessage - The message to display in the toast
 * @param {ToastType} props.toastType - The type of toast (affects styling and icon)
 * @param {() => void} props.onDismiss - Callback when toast should be dismissed
 * @param {number} [props.autoDismissMs=3000] - Auto-dismiss timeout (0 disables auto-dismiss)
 * 
 * @returns {React.ReactElement | null} The toast notification element or null if not shown
 * 
 * @example
 * ```tsx
 * <NotificationSystem
 *   showToast={true}
 *   toastMessage="Operation completed successfully"
 *   toastType="success"
 *   onDismiss={() => setShowToast(false)}
 *   autoDismissMs={5000}
 * />
 * ```
 */
export const NotificationSystem: React.FC<NotificationSystemProps> = ({
  showToast,
  toastMessage,
  toastType,
  onDismiss,
  autoDismissMs = 3000
}) => {
  // Auto-dismiss logic
  useEffect(() => {
    if (showToast && autoDismissMs > 0) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoDismissMs);
      
      return () => clearTimeout(timer);
    }
  }, [showToast, onDismiss, autoDismissMs]);

  if (!showToast) {
    return null;
  }

  return (
    <div className={`fixed top-4 right-4 z-50 transition-all duration-300 ease-in-out transform ${
      showToast ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
    }`}>
      <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-80 ${
        toastType === 'success' ? 'bg-green-50 border border-green-200' :
        toastType === 'error' ? 'bg-red-50 border border-red-200' :
        'bg-blue-50 border border-blue-200'
      }`}>
        <div className={`flex-shrink-0 w-5 h-5 ${
          toastType === 'success' ? 'text-green-600' :
          toastType === 'error' ? 'text-red-600' :
          'text-blue-600'
        }`}>
          {toastType === 'success' && (
            <CheckCircle className="w-5 h-5" />
          )}
          {toastType === 'error' && (
            <AlertCircle className="w-5 h-5" />
          )}
          {toastType === 'info' && (
            <AlertCircle className="w-5 h-5" />
          )}
        </div>
        <p className={`text-sm font-medium ${
          toastType === 'success' ? 'text-green-800' :
          toastType === 'error' ? 'text-red-800' :
          'text-blue-800'
        }`}>
          {toastMessage}
        </p>
        <button
          onClick={onDismiss}
          className={`flex-shrink-0 ml-auto pl-3 ${
            toastType === 'success' ? 'text-green-600 hover:text-green-800' :
            toastType === 'error' ? 'text-red-600 hover:text-red-800' :
            'text-blue-600 hover:text-blue-800'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
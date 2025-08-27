/**
 * Toast notification system component.
 * Provides configurable toast notifications with auto-dismiss functionality.
 */

import React, { useEffect } from 'react';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface NotificationSystemProps {
  showToast: boolean;
  toastMessage: string;
  toastType: ToastType;
  onDismiss: () => void;
  autoDismissMs?: number;
}

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
/**
 * Toast notification utilities.
 * Provides helper functions for toast notification management.
 */

import { useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastState {
  showToast: boolean;
  toastMessage: string;
  toastType: ToastType;
}

export interface ToastActions {
  showToastNotification: (message: string, type?: ToastType) => void;
  dismissToast: () => void;
}

export const useToastNotifications = (): ToastState & ToastActions => {
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('success');

  const showToastNotification = useCallback((message: string, type: ToastType = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
  }, []);

  const dismissToast = useCallback(() => {
    setShowToast(false);
  }, []);

  return {
    showToast,
    toastMessage,
    toastType,
    showToastNotification,
    dismissToast
  };
};
/**
 * Toast notification utilities.
 * Provides helper functions and custom hooks for toast notification management.
 * 
 * @fileoverview This module contains utilities for managing toast notifications
 * in the annotation interface, including state management and user interactions.
 */

import { useState, useCallback } from 'react';

/**
 * Types of toast notifications supported by the system.
 * @typedef {'success' | 'error' | 'info'} ToastType
 */
export type ToastType = 'success' | 'error' | 'info';

/**
 * State interface for toast notifications.
 * @interface ToastState
 */
export interface ToastState {
  /** Whether a toast notification is currently visible */
  showToast: boolean;
  /** The message content of the current toast */
  toastMessage: string;
  /** The type/style of the current toast */
  toastType: ToastType;
}

/**
 * Action interface for controlling toast notifications.
 * @interface ToastActions
 */
export interface ToastActions {
  /** Function to show a new toast notification */
  showToastNotification: (message: string, type?: ToastType) => void;
  /** Function to dismiss the current toast */
  dismissToast: () => void;
}

/**
 * Custom hook for managing toast notification state and actions.
 * 
 * Provides a complete toast notification system with state management,
 * including functions to show and dismiss notifications.
 * 
 * @returns {ToastState & ToastActions} Combined state and actions for toast management
 * 
 * @example
 * ```tsx
 * const { showToast, toastMessage, toastType, showToastNotification, dismissToast } = useToastNotifications();
 * 
 * // Show a success notification
 * showToastNotification('Operation completed successfully');
 * 
 * // Show an error notification
 * showToastNotification('Something went wrong', 'error');
 * 
 * // Dismiss current notification
 * dismissToast();
 * ```
 */
export const useToastNotifications = (): ToastState & ToastActions => {
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('success');

  /**
   * Shows a toast notification with the specified message and type.
   * 
   * @param {string} message - The message to display in the toast
   * @param {ToastType} [type='success'] - The type of toast (success, error, or info)
   */
  const showToastNotification = useCallback((message: string, type: ToastType = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
  }, []);

  /**
   * Dismisses the currently displayed toast notification.
   */
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
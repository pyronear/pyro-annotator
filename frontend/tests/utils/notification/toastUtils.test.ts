/**
 * Tests for toast notification utilities.
 */

import { renderHook, act } from '@testing-library/react';
import { useToastNotifications } from '@/utils/notification/toastUtils';

describe('useToastNotifications', () => {
  it('should initialize with default values', () => {
    const { result } = renderHook(() => useToastNotifications());

    expect(result.current.showToast).toBe(false);
    expect(result.current.toastMessage).toBe('');
    expect(result.current.toastType).toBe('success');
    expect(typeof result.current.showToastNotification).toBe('function');
    expect(typeof result.current.dismissToast).toBe('function');
  });

  it('should show toast notification with default success type', () => {
    const { result } = renderHook(() => useToastNotifications());

    act(() => {
      result.current.showToastNotification('Test message');
    });

    expect(result.current.showToast).toBe(true);
    expect(result.current.toastMessage).toBe('Test message');
    expect(result.current.toastType).toBe('success');
  });

  it('should show toast notification with specified type', () => {
    const { result } = renderHook(() => useToastNotifications());

    act(() => {
      result.current.showToastNotification('Error message', 'error');
    });

    expect(result.current.showToast).toBe(true);
    expect(result.current.toastMessage).toBe('Error message');
    expect(result.current.toastType).toBe('error');
  });

  it('should show info type notification', () => {
    const { result } = renderHook(() => useToastNotifications());

    act(() => {
      result.current.showToastNotification('Info message', 'info');
    });

    expect(result.current.showToast).toBe(true);
    expect(result.current.toastMessage).toBe('Info message');
    expect(result.current.toastType).toBe('info');
  });

  it('should dismiss toast notification', () => {
    const { result } = renderHook(() => useToastNotifications());

    // First show a notification
    act(() => {
      result.current.showToastNotification('Test message');
    });
    expect(result.current.showToast).toBe(true);

    // Then dismiss it
    act(() => {
      result.current.dismissToast();
    });
    expect(result.current.showToast).toBe(false);
  });

  it('should handle multiple sequential notifications', () => {
    const { result } = renderHook(() => useToastNotifications());

    // Show first notification
    act(() => {
      result.current.showToastNotification('First message', 'success');
    });
    expect(result.current.toastMessage).toBe('First message');
    expect(result.current.toastType).toBe('success');

    // Show second notification (should replace the first)
    act(() => {
      result.current.showToastNotification('Second message', 'error');
    });
    expect(result.current.toastMessage).toBe('Second message');
    expect(result.current.toastType).toBe('error');
    expect(result.current.showToast).toBe(true);
  });

  it('should maintain state consistency when dismissed multiple times', () => {
    const { result } = renderHook(() => useToastNotifications());

    // Show notification
    act(() => {
      result.current.showToastNotification('Test message');
    });

    // Dismiss multiple times
    act(() => {
      result.current.dismissToast();
      result.current.dismissToast();
      result.current.dismissToast();
    });

    expect(result.current.showToast).toBe(false);
  });

  it('should preserve message and type when dismissed', () => {
    const { result } = renderHook(() => useToastNotifications());

    act(() => {
      result.current.showToastNotification('Test message', 'error');
    });

    const messageBeforeDismiss = result.current.toastMessage;
    const typeBeforeDismiss = result.current.toastType;

    act(() => {
      result.current.dismissToast();
    });

    // Message and type should remain the same, only showToast should change
    expect(result.current.showToast).toBe(false);
    expect(result.current.toastMessage).toBe(messageBeforeDismiss);
    expect(result.current.toastType).toBe(typeBeforeDismiss);
  });

  it('should handle empty message', () => {
    const { result } = renderHook(() => useToastNotifications());

    act(() => {
      result.current.showToastNotification('');
    });

    expect(result.current.showToast).toBe(true);
    expect(result.current.toastMessage).toBe('');
    expect(result.current.toastType).toBe('success');
  });
});
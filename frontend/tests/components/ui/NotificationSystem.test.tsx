/**
 * Tests for NotificationSystem component.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationSystem } from '@/components/ui/NotificationSystem';

// Mock the icons to avoid test complications
vi.mock('lucide-react', () => ({
  CheckCircle: () => <div data-testid="check-circle">✓</div>,
  AlertCircle: () => <div data-testid="alert-circle">!</div>,
  X: () => <div data-testid="x-icon">×</div>,
}));

describe('NotificationSystem', () => {
  const defaultProps = {
    showToast: true,
    toastMessage: 'Test message',
    toastType: 'success' as const,
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render nothing when showToast is false', () => {
    const { container } = render(
      <NotificationSystem {...defaultProps} showToast={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render success notification with correct styling', () => {
    render(<NotificationSystem {...defaultProps} />);
    
    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByTestId('check-circle')).toBeInTheDocument();
    
    const container = screen.getByText('Test message').closest('.px-4');
    expect(container).toHaveClass('bg-green-50', 'border-green-200');
  });

  it('should render error notification with correct styling', () => {
    render(<NotificationSystem {...defaultProps} toastType="error" />);
    
    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByTestId('alert-circle')).toBeInTheDocument();
    
    const container = screen.getByText('Test message').closest('.px-4');
    expect(container).toHaveClass('bg-red-50', 'border-red-200');
  });

  it('should render info notification with correct styling', () => {
    render(<NotificationSystem {...defaultProps} toastType="info" />);
    
    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByTestId('alert-circle')).toBeInTheDocument();
    
    const container = screen.getByText('Test message').closest('.px-4');
    expect(container).toHaveClass('bg-blue-50', 'border-blue-200');
  });

  it('should call onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<NotificationSystem {...defaultProps} onDismiss={onDismiss} />);
    
    const closeButton = screen.getByTestId('x-icon').closest('button');
    fireEvent.click(closeButton!);
    
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should auto-dismiss after specified time', async () => {
    const onDismiss = vi.fn();
    render(
      <NotificationSystem 
        {...defaultProps} 
        onDismiss={onDismiss}
        autoDismissMs={1000}
      />
    );
    
    expect(onDismiss).not.toHaveBeenCalled();
    
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    }, { timeout: 1200 });
  });

  it('should not auto-dismiss when autoDismissMs is 0', async () => {
    const onDismiss = vi.fn();
    render(
      <NotificationSystem 
        {...defaultProps} 
        onDismiss={onDismiss}
        autoDismissMs={0}
      />
    );
    
    // Wait a bit to ensure it doesn't auto-dismiss
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should cancel auto-dismiss timer when unmounted', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <NotificationSystem 
        {...defaultProps} 
        onDismiss={onDismiss}
        autoDismissMs={1000}
      />
    );
    
    unmount();
    
    // Timer should be cleared, so onDismiss shouldn't be called
    setTimeout(() => {
      expect(onDismiss).not.toHaveBeenCalled();
    }, 1200);
  });

  it('should reset auto-dismiss timer when showToast changes', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <NotificationSystem 
        {...defaultProps} 
        onDismiss={onDismiss}
        autoDismissMs={1000}
        showToast={true}
      />
    );
    
    // Wait half the timeout
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Change showToast to false and back to true (simulating new notification)
    rerender(
      <NotificationSystem 
        {...defaultProps} 
        onDismiss={onDismiss}
        autoDismissMs={1000}
        showToast={false}
      />
    );
    
    rerender(
      <NotificationSystem 
        {...defaultProps} 
        onDismiss={onDismiss}
        autoDismissMs={1000}
        showToast={true}
      />
    );
    
    // Should restart the timer
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    }, { timeout: 1200 });
  });

  it('should display different messages correctly', () => {
    const { rerender } = render(
      <NotificationSystem {...defaultProps} toastMessage="First message" />
    );
    expect(screen.getByText('First message')).toBeInTheDocument();
    
    rerender(
      <NotificationSystem {...defaultProps} toastMessage="Second message" />
    );
    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(screen.queryByText('First message')).not.toBeInTheDocument();
  });

  it('should render with correct accessibility attributes', () => {
    render(<NotificationSystem {...defaultProps} />);
    
    const closeButton = screen.getByTestId('x-icon').closest('button');
    expect(closeButton).toBeInTheDocument();
    
    // Should have proper button semantics
    expect(closeButton?.tagName).toBe('BUTTON');
  });

  it('should handle long messages without breaking layout', () => {
    const longMessage = 'This is a very long message that should still display correctly without breaking the layout or causing any visual issues in the notification system component.';
    
    render(<NotificationSystem {...defaultProps} toastMessage={longMessage} />);
    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });

  it('should apply correct transition classes', () => {
    const { container } = render(<NotificationSystem {...defaultProps} />);
    
    const notificationDiv = container.querySelector('.fixed.top-4.right-4');
    expect(notificationDiv).toHaveClass(
      'transition-all',
      'duration-300',
      'ease-in-out',
      'transform',
      'translate-x-0',
      'opacity-100'
    );
  });
});
/**
 * Higher-Order Component for consistent loading state management
 * 
 * This HOC provides a consistent loading UI pattern across components
 * and handles error boundaries with pure error display functions.
 */

import React, { ComponentType, ReactNode } from 'react';

/**
 * Props that will be injected by the HOC
 */
export interface WithLoadingStateProps {
  /** Whether the component is in a loading state */
  readonly isLoading?: boolean;
  /** Error message to display, if any */
  readonly error?: string | Error | null;
  /** Whether to show the error in a modal/prominent way */
  readonly isErrorCritical?: boolean;
}

/**
 * Configuration options for the loading state HOC
 */
export interface WithLoadingStateOptions {
  /** Custom loading component */
  readonly LoadingComponent?: ComponentType;
  /** Custom error component */
  readonly ErrorComponent?: ComponentType<{ readonly error: string; readonly onRetry?: () => void }>;
  /** Whether to show retry button on errors */
  readonly showRetry?: boolean;
  /** Custom retry handler */
  readonly onRetry?: () => void;
  /** Minimum loading time in milliseconds to prevent flashing */
  readonly minLoadingTime?: number;
}

/**
 * Pure loading spinner component
 * 
 * @pure Component renders consistently without side effects
 */
const DefaultLoadingComponent = () => (
  <div className="flex items-center justify-center min-h-32">
    <div className="flex flex-col items-center space-y-3">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      <p className="text-sm text-gray-500">Loading...</p>
    </div>
  </div>
);

/**
 * Pure error display component
 * 
 * @pure Component renders consistently for the same error input
 */
interface DefaultErrorComponentProps {
  readonly error: string;
  readonly onRetry?: () => void;
}

const DefaultErrorComponent = ({ error, onRetry }: DefaultErrorComponentProps) => (
  <div className="flex items-center justify-center min-h-32">
    <div className="text-center max-w-md">
      <div className="mb-4">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h3>
        <p className="text-sm text-gray-600 mb-4">{error}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          Try Again
        </button>
      )}
    </div>
  </div>
);

/**
 * Pure function to normalize error to string
 * 
 * @pure Function always returns same output for same input
 */
const normalizeError = (error: string | Error | null | undefined): string => {
  if (!error) return 'An unknown error occurred';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'An error occurred';
  return String(error);
};

/**
 * Pure function to determine if component should show loading state
 * 
 * @pure Function has no side effects
 */
const shouldShowLoading = (
  isLoading: boolean | undefined,
  error: string | Error | null | undefined,
  hasMinLoadingTime: boolean,
  loadingStartTime: number | null,
  minLoadingTime: number
): boolean => {
  if (error) return false; // Don't show loading if there's an error
  if (!isLoading) return false;
  
  if (!hasMinLoadingTime || loadingStartTime === null) return true;
  
  const elapsed = Date.now() - loadingStartTime;
  return elapsed < minLoadingTime;
};

/**
 * Higher-Order Component that provides consistent loading state management
 * 
 * This HOC wraps components to provide standardized loading and error states,
 * preventing code duplication and ensuring consistent UX across the application.
 * 
 * @param Component - The component to wrap
 * @param options - Configuration options for loading behavior
 * @returns Enhanced component with loading state management
 * 
 * @example
 * interface MyDataComponentProps extends WithLoadingStateProps {
 *   readonly data: string[];
 * }
 * 
 * const MyDataComponent = ({ data }: MyDataComponentProps) => (
 *   <div>
 *     {data.map(item => <div key={item}>{item}</div>)}
 *   </div>
 * );
 * 
 * export default withLoadingState(MyDataComponent, {
 *   minLoadingTime: 500,
 *   showRetry: true
 * });
 * 
 * // Usage:
 * <EnhancedComponent 
 *   data={myData} 
 *   isLoading={isDataLoading} 
 *   error={dataError} 
 * />
 */
export const withLoadingState = <P extends WithLoadingStateProps>(
  Component: ComponentType<P>,
  options: WithLoadingStateOptions = {}
) => {
  const {
    LoadingComponent = DefaultLoadingComponent,
    ErrorComponent = DefaultErrorComponent,
    showRetry = false,
    onRetry,
    minLoadingTime = 0
  } = options;

  const WithLoadingStateComponent = (props: P) => {
    const { isLoading, error, isErrorCritical, ...restProps } = props;
    const [loadingStartTime, setLoadingStartTime] = React.useState<number | null>(null);

    // Track loading start time for minimum loading duration
    React.useEffect(() => {
      if (isLoading && minLoadingTime > 0) {
        setLoadingStartTime(Date.now());
      } else if (!isLoading) {
        setLoadingStartTime(null);
      }
    }, [isLoading, minLoadingTime]);

    // Determine current display state using pure functions
    const normalizedError = normalizeError(error);
    const showLoading = shouldShowLoading(
      isLoading, 
      error, 
      minLoadingTime > 0, 
      loadingStartTime, 
      minLoadingTime
    );

    // Show error state
    if (error && !showLoading) {
      return (
        <ErrorComponent 
          error={normalizedError} 
          onRetry={showRetry ? onRetry : undefined}
        />
      );
    }

    // Show loading state
    if (showLoading) {
      return <LoadingComponent />;
    }

    // Show the wrapped component
    return <Component {...restProps as P} />;
  };

  WithLoadingStateComponent.displayName = `withLoadingState(${Component.displayName || Component.name || 'Component'})`;

  return WithLoadingStateComponent;
};

/**
 * Hook version for use with functional components that prefer hooks over HOCs
 * 
 * @param isLoading - Whether currently loading
 * @param error - Error to display
 * @param options - Configuration options
 * @returns Render function for loading/error states
 * 
 * @example
 * const MyComponent = ({ data, isLoading, error }) => {
 *   const renderLoadingState = useLoadingState(isLoading, error, {
 *     minLoadingTime: 300,
 *     showRetry: true,
 *     onRetry: () => refetch()
 *   });
 * 
 *   // Check if we should render loading/error state
 *   const loadingStateRender = renderLoadingState();
 *   if (loadingStateRender) return loadingStateRender;
 * 
 *   // Render main content
 *   return <div>{data}</div>;
 * };
 */
export const useLoadingState = (
  isLoading: boolean | undefined,
  error: string | Error | null | undefined,
  options: WithLoadingStateOptions = {}
) => {
  const {
    LoadingComponent = DefaultLoadingComponent,
    ErrorComponent = DefaultErrorComponent,
    showRetry = false,
    onRetry,
    minLoadingTime = 0
  } = options;

  const [loadingStartTime, setLoadingStartTime] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (isLoading && minLoadingTime > 0) {
      setLoadingStartTime(Date.now());
    } else if (!isLoading) {
      setLoadingStartTime(null);
    }
  }, [isLoading, minLoadingTime]);

  const renderLoadingState = React.useCallback((): ReactNode | null => {
    const normalizedError = normalizeError(error);
    const showLoading = shouldShowLoading(
      isLoading, 
      error, 
      minLoadingTime > 0, 
      loadingStartTime, 
      minLoadingTime
    );

    if (error && !showLoading) {
      return (
        <ErrorComponent 
          error={normalizedError} 
          onRetry={showRetry ? onRetry : undefined}
        />
      );
    }

    if (showLoading) {
      return <LoadingComponent />;
    }

    return null;
  }, [isLoading, error, loadingStartTime, LoadingComponent, ErrorComponent, showRetry, onRetry, minLoadingTime]);

  return renderLoadingState;
};
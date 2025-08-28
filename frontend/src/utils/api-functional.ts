import { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

/**
 * Pure functional utilities for API client enhancement
 *
 * These utilities provide composable, pure functions for HTTP request
 * transformation, error handling, and response processing.
 */

/**
 * HTTP method types for type safety
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Extended AxiosRequestConfig with metadata support
 */
export interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  metadata?: {
    timestamp?: number;
    requestId?: string;
    [key: string]: unknown;
  };
}

/**
 * Generic API request configuration
 */
export interface ApiRequestConfig<TParams = Record<string, unknown>>
  extends Omit<AxiosRequestConfig, 'method' | 'url'> {
  readonly method: HttpMethod;
  readonly url: string;
  readonly params?: TParams;
}

/**
 * API response wrapper with metadata
 */
export interface ApiResponse<TData = unknown> {
  readonly data: TData;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly requestId?: string;
  readonly duration?: number;
}

/**
 * Structured API error information
 */
export interface ApiErrorDetails {
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestConfig?: ApiRequestConfig;
}

/**
 * Request transformation function type
 */
export type RequestTransformer<TInput = unknown, TOutput = unknown> = (input: TInput) => TOutput;

/**
 * Response transformation function type
 */
export type ResponseTransformer<TInput = unknown, TOutput = unknown> = (input: TInput) => TOutput;

/**
 * Error transformation function type
 */
export type ErrorTransformer = (error: AxiosError) => ApiErrorDetails;

/**
 * Creates a pure request configuration builder
 *
 * @pure Function returns request builder without side effects
 * @param baseConfig - Base configuration to merge with
 * @returns Function that builds complete request configs
 *
 * @example
 * const buildRequest = createRequestBuilder({ timeout: 5000 });
 * const config = buildRequest('GET', '/api/users', { limit: 10 });
 */
export const createRequestBuilder = (baseConfig: Partial<AxiosRequestConfig> = {}) => {
  return <TParams = Record<string, unknown>>(
    method: HttpMethod,
    url: string,
    params?: TParams,
    additionalConfig: Partial<AxiosRequestConfig> = {}
  ): ApiRequestConfig<TParams> => ({
    ...baseConfig,
    ...additionalConfig,
    method,
    url,
    params,
  });
};

/**
 * Creates a composable request transformer pipeline
 *
 * @pure Function composes multiple transformers into one
 * @param transformers - Array of transformation functions
 * @returns Combined transformation function
 *
 * @example
 * const transform = createRequestTransformer([
 *   addAuthHeaders,
 *   addTimestamp,
 *   validateConfig
 * ]);
 * const finalConfig = transform(initialConfig);
 */
export const createRequestTransformer = <TInput, TOutput>(
  ...transformers: RequestTransformer[]
): RequestTransformer<TInput, TOutput> => {
  return (input: TInput): TOutput => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transformers.reduce((acc, transformer) => transformer(acc), input as any);
  };
};

/**
 * Creates a composable response transformer pipeline
 *
 * @pure Function composes response transformations
 * @param transformers - Array of response transformation functions
 * @returns Combined response transformation function
 *
 * @example
 * const transform = createResponseTransformer(
 *   extractData,
 *   validateResponse,
 *   formatDates
 * );
 * const processedData = transform(axiosResponse);
 */
export const createResponseTransformer = <TInput, TOutput>(
  ...transformers: ResponseTransformer[]
): ResponseTransformer<TInput, TOutput> => {
  return (input: TInput): TOutput => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transformers.reduce((acc, transformer) => transformer(acc), input as any);
  };
};

/**
 * Creates a standardized error transformer
 *
 * @pure Function transforms axios errors to consistent format
 * @param includeRequestDetails - Whether to include request config in error
 * @returns Error transformation function
 *
 * @example
 * const transformError = createErrorTransformer(true);
 * const apiError = transformError(axiosError);
 */
export const createErrorTransformer = (
  includeRequestDetails: boolean = false
): ErrorTransformer => {
  return (error: AxiosError): ApiErrorDetails => {
    const baseError: ApiErrorDetails = {
      message: error.message || 'Unknown API error occurred',
      status: error.response?.status,
      statusText: error.response?.statusText,
      code: error.code,
      details: error.response?.data,
    };

    if (includeRequestDetails && error.config) {
      return {
        ...baseError,
        requestConfig: {
          method: (error.config.method?.toUpperCase() as HttpMethod) || 'GET',
          url: error.config.url || '',
          params: error.config.params,
        },
      };
    }

    return baseError;
  };
};

/**
 * Common request transformers
 */
export const requestTransformers = {
  /**
   * Adds timestamp to request configuration
   *
   * @pure Function adds timestamp without mutation
   */
  addTimestamp: <T extends ExtendedAxiosRequestConfig>(config: T): T => ({
    ...config,
    metadata: {
      ...config.metadata,
      timestamp: Date.now(),
    },
  }),

  /**
   * Adds request ID for tracing
   *
   * @pure Function adds unique request ID
   */
  addRequestId: <T extends AxiosRequestConfig>(config: T): T => ({
    ...config,
    headers: {
      ...config.headers,
      'X-Request-ID': `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    },
  }),

  /**
   * Adds common JSON headers
   *
   * @pure Function ensures JSON content type
   */
  addJsonHeaders: <T extends AxiosRequestConfig>(config: T): T => ({
    ...config,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    },
  }),

  /**
   * Validates required configuration properties
   *
   * @pure Function validates config and returns original or throws
   */
  validateRequired: <T extends AxiosRequestConfig>(config: T): T => {
    if (!config.url) {
      throw new Error('Request URL is required');
    }
    if (!config.method) {
      throw new Error('Request method is required');
    }
    return config;
  },
};

/**
 * Common response transformers
 */
export const responseTransformers = {
  /**
   * Extracts data from axios response
   *
   * @pure Function extracts response data
   */
  extractData: <T>(response: AxiosResponse<T>): T => response.data,

  /**
   * Wraps response with metadata
   *
   * @pure Function creates enhanced response object
   */
  wrapWithMetadata: <T>(response: AxiosResponse<T>): ApiResponse<T> => ({
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers as Record<string, string>,
    requestId: response.headers['X-Request-ID'] || response.config?.headers?.['X-Request-ID'],
  }),

  /**
   * Validates response status codes
   *
   * @pure Function validates status and returns data or throws
   */
  validateStatus: <T>(response: AxiosResponse<T>): AxiosResponse<T> => {
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  },

  /**
   * Transforms date strings to Date objects
   *
   * @pure Function recursively processes date strings
   */
  parseDates: <T>(data: T): T => {
    if (data === null || data === undefined || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => responseTransformers.parseDates(item)) as T;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { ...data } as any;
    const dateFields = [
      'created_at',
      'updated_at',
      'recorded_at',
      'last_seen_at',
      'last_modified_at',
    ];

    for (const [key, value] of Object.entries(result)) {
      if (dateFields.includes(key) && typeof value === 'string') {
        result[key] = new Date(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = responseTransformers.parseDates(value);
      }
    }

    return result;
  },
};

/**
 * Creates a functional HTTP client wrapper
 *
 * @pure Function creates client factory with transformations
 * @param axiosInstance - Configured axios instance
 * @param requestTransformer - Request transformation pipeline
 * @param responseTransformer - Response transformation pipeline
 * @param errorTransformer - Error transformation function
 * @returns Functional HTTP client methods
 *
 * @example
 * const client = createFunctionalClient(
 *   axiosInstance,
 *   createRequestTransformer(addTimestamp, addJsonHeaders),
 *   createResponseTransformer(validateStatus, extractData),
 *   createErrorTransformer(true)
 * );
 *
 * const users = await client.get('/users', { limit: 10 });
 */
export const createFunctionalClient = (
  axiosInstance: AxiosInstance,
  requestTransformer?: RequestTransformer,
  responseTransformer?: ResponseTransformer,
  errorTransformer: ErrorTransformer = createErrorTransformer()
) => {
  const buildRequest = createRequestBuilder();

  const executeRequest = async <TResponse = unknown, TParams = Record<string, unknown>>(
    config: ApiRequestConfig<TParams>
  ): Promise<TResponse> => {
    try {
      // Apply request transformation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalConfig = requestTransformer ? requestTransformer(config) : (config as any);

      // Execute request
      const response = await axiosInstance.request(finalConfig);

      // Apply response transformation
      return responseTransformer ? (responseTransformer(response) as TResponse) : response.data;
    } catch (error) {
      // Transform error and re-throw
      const transformedError = errorTransformer(error as AxiosError);
      const apiError = new Error(transformedError.message) as Error & { details: ApiErrorDetails };
      apiError.details = transformedError;
      throw apiError;
    }
  };

  return {
    /**
     * Executes GET request
     */
    get: <TResponse = unknown, TParams = Record<string, unknown>>(
      url: string,
      params?: TParams,
      config?: Partial<AxiosRequestConfig>
    ): Promise<TResponse> => {
      return executeRequest(buildRequest('GET', url, params, config));
    },

    /**
     * Executes POST request
     */
    post: <TResponse = unknown, TData = unknown>(
      url: string,
      data?: TData,
      config?: Partial<AxiosRequestConfig>
    ): Promise<TResponse> => {
      return executeRequest(buildRequest('POST', url, undefined, { ...config, data }));
    },

    /**
     * Executes PUT request
     */
    put: <TResponse = unknown, TData = unknown>(
      url: string,
      data?: TData,
      config?: Partial<AxiosRequestConfig>
    ): Promise<TResponse> => {
      return executeRequest(buildRequest('PUT', url, undefined, { ...config, data }));
    },

    /**
     * Executes PATCH request
     */
    patch: <TResponse = unknown, TData = unknown>(
      url: string,
      data?: TData,
      config?: Partial<AxiosRequestConfig>
    ): Promise<TResponse> => {
      return executeRequest(buildRequest('PATCH', url, undefined, { ...config, data }));
    },

    /**
     * Executes DELETE request
     */
    delete: <TResponse = unknown>(
      url: string,
      config?: Partial<AxiosRequestConfig>
    ): Promise<TResponse> => {
      return executeRequest(buildRequest('DELETE', url, undefined, config));
    },

    /**
     * Executes arbitrary request
     */
    request: executeRequest,
  };
};

/**
 * Creates a retry wrapper for API requests
 *
 * @pure Function creates retry logic without side effects on original client
 * @param client - Functional HTTP client
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelay - Delay between retries in milliseconds
 * @returns Client with retry capabilities
 *
 * @example
 * const retryClient = createRetryWrapper(client, 3, 1000);
 * const data = await retryClient.get('/unreliable-endpoint');
 */
export const createRetryWrapper = (
  client: ReturnType<typeof createFunctionalClient>,
  maxRetries: number = 3,
  retryDelay: number = 1000
) => {
  const withRetry = async <T>(operation: () => Promise<T>, attempt: number = 1): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      return withRetry(operation, attempt + 1);
    }
  };

  return {
    get: <TResponse = unknown, TParams = Record<string, unknown>>(
      url: string,
      params?: TParams,
      config?: Partial<AxiosRequestConfig>
    ) => withRetry(() => client.get<TResponse, TParams>(url, params, config)),

    post: <TResponse = unknown, TData = unknown>(
      url: string,
      data?: TData,
      config?: Partial<AxiosRequestConfig>
    ) => withRetry(() => client.post<TResponse, TData>(url, data, config)),

    put: <TResponse = unknown, TData = unknown>(
      url: string,
      data?: TData,
      config?: Partial<AxiosRequestConfig>
    ) => withRetry(() => client.put<TResponse, TData>(url, data, config)),

    patch: <TResponse = unknown, TData = unknown>(
      url: string,
      data?: TData,
      config?: Partial<AxiosRequestConfig>
    ) => withRetry(() => client.patch<TResponse, TData>(url, data, config)),

    delete: <TResponse = unknown>(url: string, config?: Partial<AxiosRequestConfig>) =>
      withRetry(() => client.delete<TResponse>(url, config)),

    request: <TResponse = unknown, TParams = Record<string, unknown>>(config: ApiRequestConfig<TParams>) =>
      withRetry(() => client.request<TResponse, TParams>(config)),
  };
};

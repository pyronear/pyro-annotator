/**
 * Branded types for enhanced type safety in the PyroAnnotator frontend
 *
 * These types prevent accidental mixing of different ID types and provide
 * better TypeScript intellisense and error detection at compile time.
 */

/**
 * Generic branded type utility
 *
 * Creates a unique type that wraps a base type with a brand symbol,
 * preventing accidental assignments between different branded types.
 *
 * @example
 * type UserId = Branded<number, 'UserId'>;
 * type PostId = Branded<number, 'PostId'>;
 *
 * const userId: UserId = 123 as UserId;
 * const postId: PostId = 456 as PostId;
 * // postId = userId; // TypeScript error!
 */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand };

/**
 * Utility type for creating branded constructors
 */
export type BrandedConstructor<T, Brand extends string> = (value: T) => Branded<T, Brand>;

// ===== ID Types =====

/**
 * Unique identifier for sequences
 */
export type SequenceId = Branded<number, 'SequenceId'>;

/**
 * Unique identifier for detections
 */
export type DetectionId = Branded<number, 'DetectionId'>;

/**
 * Unique identifier for sequence annotations
 */
export type SequenceAnnotationId = Branded<number, 'SequenceAnnotationId'>;

/**
 * Unique identifier for detection annotations
 */
export type DetectionAnnotationId = Branded<number, 'DetectionAnnotationId'>;

/**
 * Unique identifier for cameras
 */
export type CameraId = Branded<number, 'CameraId'>;

/**
 * Unique identifier for organizations
 */
export type OrganizationId = Branded<number, 'OrganizationId'>;

/**
 * Unique identifier for drawn rectangles in the UI
 */
export type DrawnRectangleId = Branded<string, 'DrawnRectangleId'>;

// ===== Coordinate Types =====

/**
 * Normalized bounding box coordinates (0-1 range)
 */
export type NormalizedBbox = Branded<[number, number, number, number], 'NormalizedBbox'>;

/**
 * Pixel coordinates for screen positioning
 */
export type PixelCoordinates = Branded<{ x: number; y: number }, 'PixelCoordinates'>;

/**
 * Normalized coordinates (0-1 range)
 */
export type NormalizedCoordinates = Branded<{ x: number; y: number }, 'NormalizedCoordinates'>;

/**
 * Geographic latitude (-90 to 90)
 */
export type Latitude = Branded<number, 'Latitude'>;

/**
 * Geographic longitude (-180 to 180)
 */
export type Longitude = Branded<number, 'Longitude'>;

/**
 * Camera azimuth in degrees (0-360)
 */
export type Azimuth = Branded<number, 'Azimuth'>;

// ===== Temporal Types =====

/**
 * ISO 8601 timestamp string
 */
export type IsoTimestamp = Branded<string, 'IsoTimestamp'>;

/**
 * Date string in YYYY-MM-DD format for date inputs
 */
export type DateInputString = Branded<string, 'DateInputString'>;

/**
 * Unix timestamp in milliseconds
 */
export type UnixTimestamp = Branded<number, 'UnixTimestamp'>;

// ===== Measurement Types =====

/**
 * Confidence score (0-1 range)
 */
export type ConfidenceScore = Branded<number, 'ConfidenceScore'>;

/**
 * Percentage value (0-100)
 */
export type Percentage = Branded<number, 'Percentage'>;

/**
 * Pixel dimension (width or height)
 */
export type PixelDimension = Branded<number, 'PixelDimension'>;

/**
 * Zoom level multiplier (positive number)
 */
export type ZoomLevel = Branded<number, 'ZoomLevel'>;

// ===== API Types =====

/**
 * Base URL for API endpoints
 */
export type ApiBaseUrl = Branded<string, 'ApiBaseUrl'>;

/**
 * API endpoint path
 */
export type ApiEndpoint = Branded<string, 'ApiEndpoint'>;

/**
 * Request ID for tracing
 */
export type RequestId = Branded<string, 'RequestId'>;

// ===== Validation Results =====

/**
 * Validation state for form fields
 */
export type ValidationState = 'valid' | 'invalid' | 'pending' | 'untouched';

/**
 * Form field with validation
 */
export interface ValidatedField<T> {
  readonly value: T;
  readonly state: ValidationState;
  readonly errors: readonly string[];
  readonly touched: boolean;
}

// ===== Constructor Functions =====

/**
 * Safe constructors for branded types with validation
 */
export const create = {
  /**
   * Creates a SequenceId with validation
   */
  sequenceId: (value: number): SequenceId => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('SequenceId must be a positive integer');
    }
    return value as SequenceId;
  },

  /**
   * Creates a DetectionId with validation
   */
  detectionId: (value: number): DetectionId => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('DetectionId must be a positive integer');
    }
    return value as DetectionId;
  },

  /**
   * Creates a NormalizedBbox with validation
   */
  normalizedBbox: (coords: [number, number, number, number]): NormalizedBbox => {
    const [x1, y1, x2, y2] = coords;

    if (!coords.every(c => typeof c === 'number' && c >= 0 && c <= 1)) {
      throw new Error('NormalizedBbox coordinates must be between 0 and 1');
    }

    if (x1 >= x2 || y1 >= y2) {
      throw new Error('NormalizedBbox must have positive dimensions');
    }

    return coords as NormalizedBbox;
  },

  /**
   * Creates a ConfidenceScore with validation
   */
  confidenceScore: (value: number): ConfidenceScore => {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new Error('ConfidenceScore must be between 0 and 1');
    }
    return value as ConfidenceScore;
  },

  /**
   * Creates a Percentage with validation
   */
  percentage: (value: number): Percentage => {
    if (typeof value !== 'number' || value < 0 || value > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }
    return value as Percentage;
  },

  /**
   * Creates a Latitude with validation
   */
  latitude: (value: number): Latitude => {
    if (typeof value !== 'number' || value < -90 || value > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    return value as Latitude;
  },

  /**
   * Creates a Longitude with validation
   */
  longitude: (value: number): Longitude => {
    if (typeof value !== 'number' || value < -180 || value > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }
    return value as Longitude;
  },

  /**
   * Creates an IsoTimestamp with validation
   */
  isoTimestamp: (value: string): IsoTimestamp => {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error('IsoTimestamp must be a valid ISO 8601 date string');
    }
    return value as IsoTimestamp;
  },

  /**
   * Creates a DateInputString with validation
   */
  dateInputString: (value: string): DateInputString => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(value)) {
      throw new Error('DateInputString must be in YYYY-MM-DD format');
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error('DateInputString must represent a valid date');
    }

    return value as DateInputString;
  },

  /**
   * Creates a ZoomLevel with validation
   */
  zoomLevel: (value: number): ZoomLevel => {
    if (typeof value !== 'number' || value <= 0) {
      throw new Error('ZoomLevel must be a positive number');
    }
    return value as ZoomLevel;
  },

  /**
   * Creates a RequestId with validation
   */
  requestId: (): RequestId => {
    const id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return id as RequestId;
  },

  /**
   * Creates a DrawnRectangleId with validation
   */
  drawnRectangleId: (): DrawnRectangleId => {
    const id = `rect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return id as DrawnRectangleId;
  },
};

// ===== Type Guards =====

/**
 * Type guards for runtime type checking
 */
export const is = {
  /**
   * Checks if value is a valid SequenceId
   */
  sequenceId: (value: unknown): value is SequenceId => {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  },

  /**
   * Checks if value is a valid DetectionId
   */
  detectionId: (value: unknown): value is DetectionId => {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  },

  /**
   * Checks if value is a valid NormalizedBbox
   */
  normalizedBbox: (value: unknown): value is NormalizedBbox => {
    return (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every(c => typeof c === 'number' && c >= 0 && c <= 1) &&
      value[0] < value[2] &&
      value[1] < value[3]
    );
  },

  /**
   * Checks if value is a valid ConfidenceScore
   */
  confidenceScore: (value: unknown): value is ConfidenceScore => {
    return typeof value === 'number' && value >= 0 && value <= 1;
  },

  /**
   * Checks if value is a valid IsoTimestamp
   */
  isoTimestamp: (value: unknown): value is IsoTimestamp => {
    return typeof value === 'string' && !isNaN(new Date(value).getTime());
  },
};

// ===== Utility Functions =====

/**
 * Extracts the underlying value from a branded type
 *
 * @pure Function extracts value without changing it
 * @param brandedValue - Branded type value
 * @returns Underlying primitive value
 *
 * @example
 * const id: SequenceId = create.sequenceId(123);
 * const rawId: number = unwrap(id); // 123
 */
export const unwrap = <T>(brandedValue: Branded<T, any>): T => {
  return brandedValue as T;
};

/**
 * Maps over an array of branded values
 *
 * @pure Function transforms branded array
 * @param values - Array of branded values
 * @param mapper - Transformation function
 * @returns Array of transformed values
 *
 * @example
 * const ids: SequenceId[] = [create.sequenceId(1), create.sequenceId(2)];
 * const doubled = mapBranded(ids, id => unwrap(id) * 2);
 */
export const mapBranded = <T, Brand extends string, U>(
  values: readonly Branded<T, Brand>[],
  mapper: (value: T) => U
): readonly U[] => {
  return values.map(value => mapper(unwrap(value)));
};

/**
 * Filters an array of branded values
 *
 * @pure Function filters branded array
 * @param values - Array of branded values
 * @param predicate - Filter predicate
 * @returns Filtered array of branded values
 *
 * @example
 * const ids: SequenceId[] = [create.sequenceId(1), create.sequenceId(2), create.sequenceId(3)];
 * const evenIds = filterBranded(ids, id => unwrap(id) % 2 === 0);
 */
export const filterBranded = <T, Brand extends string>(
  values: readonly Branded<T, Brand>[],
  predicate: (value: T) => boolean
): readonly Branded<T, Brand>[] => {
  return values.filter(value => predicate(unwrap(value)));
};

// ===== Enhanced Form Types =====

/**
 * Form state with branded types and validation
 */
export interface BrandedFormState<T extends Record<string, any>> {
  readonly values: T;
  readonly errors: Partial<Record<keyof T, readonly string[]>>;
  readonly touched: Partial<Record<keyof T, boolean>>;
  readonly isValid: boolean;
  readonly isSubmitting: boolean;
}

/**
 * Form field configuration with branded type support
 */
export interface BrandedFieldConfig<T> {
  readonly defaultValue: T;
  readonly validator?: (value: T) => readonly string[];
  readonly transformer?: (rawValue: any) => T;
}

/**
 * Creates a typed form configuration
 *
 * @pure Function creates form config with branded type support
 * @param config - Field configurations
 * @returns Typed form configuration
 *
 * @example
 * const formConfig = createBrandedForm({
 *   sequenceId: {
 *     defaultValue: create.sequenceId(1),
 *     validator: (id) => is.sequenceId(id) ? [] : ['Invalid sequence ID']
 *   },
 *   confidence: {
 *     defaultValue: create.confidenceScore(0.5),
 *     validator: (score) => is.confidenceScore(score) ? [] : ['Invalid confidence score']
 *   }
 * });
 */
export const createBrandedForm = <T extends Record<string, any>>(
  config: Record<keyof T, BrandedFieldConfig<T[keyof T]>>
) => {
  return config;
};

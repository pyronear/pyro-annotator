/**
 * Application constants and configuration values.
 * 
 * This module contains all constant values used throughout the PyroAnnotator frontend,
 * including API endpoints, pagination settings, UI constants, and data type enums
 * that match the backend API specification.
 * 
 * @fileoverview Central location for all application constants, ensuring consistency
 * across the entire frontend application and providing a single source of truth
 * for configuration values.
 */

/**
 * API endpoint URLs for the PyroAnnotator backend.
 * 
 * These endpoints define the REST API routes used for communicating with the backend.
 * All URLs are relative to the API base URL configured in environment variables.
 * 
 * @constant {Object} API_ENDPOINTS
 * @example
 * ```typescript
 * const sequencesUrl = `${API_BASE_URL}${API_ENDPOINTS.SEQUENCES}`;
 * // Results in: "http://localhost:5050/sequences/"
 * ```
 */
export const API_ENDPOINTS = {
  SEQUENCES: '/sequences/',
  SEQUENCE_ANNOTATIONS: '/annotations/sequences/',
  DETECTION_ANNOTATIONS: '/annotations/detections/',
  DETECTIONS: '/detections/',
  CAMERAS: '/cameras/',
  ORGANIZATIONS: '/organizations/',
  SOURCE_APIS: '/source-apis/',
  USERS: '/users/',
  USERS_ME: '/users/me',
  AUTH_LOGIN: '/auth/login',
  STATUS: '/status',
} as const;

/**
 * Default pagination settings for API requests.
 * 
 * These values are used as fallbacks when no specific pagination parameters
 * are provided by the user or component state.
 * 
 * @constant {Object} PAGINATION_DEFAULTS
 * @property {number} PAGE - Default starting page number (1-based)
 * @property {number} SIZE - Default number of items per page
 * @property {number} MAX_SIZE - Maximum allowed items per page to prevent performance issues
 * 
 * @example
 * ```typescript
 * const { page = PAGINATION_DEFAULTS.PAGE, size = PAGINATION_DEFAULTS.SIZE } = queryParams;
 * ```
 */
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  SIZE: 50,
  MAX_SIZE: 100,
} as const;

/**
 * Available pagination size options for user selection.
 * 
 * These options are presented to users in dropdowns and selection interfaces
 * to allow them to customize how many items are displayed per page.
 * 
 * @constant {readonly number[]} PAGINATION_OPTIONS
 * @example
 * ```typescript
 * {PAGINATION_OPTIONS.map(size => (
 *   <option key={size} value={size}>{size} per page</option>
 * ))}
 * ```
 */
export const PAGINATION_OPTIONS = [10, 20, 50, 100] as const;

/**
 * Supported source API types for wildfire detection data.
 * 
 * These represent the different external APIs that can provide sequence data
 * to the PyroAnnotator system. Each source has different data formats and
 * capabilities that are handled by the backend.
 * 
 * @constant {readonly string[]} SOURCE_APIS
 * @property {string} pyronear_french - Pyronear France API system
 * @property {string} alert_wildfire - Alert Wildfire detection system
 * @property {string} api_cenia - CENIA environmental monitoring API
 * 
 * @example
 * ```typescript
 * const isValidSource = SOURCE_APIS.includes(userSelectedSource);
 * ```
 */
export const SOURCE_APIS = ['pyronear_french', 'alert_wildfire', 'api_cenia'] as const;

/**
 * Processing stages for detection sequences in the annotation workflow.
 * 
 * These stages represent the progression of a detection sequence from initial
 * import through the annotation process. The stages must match the backend
 * ProcessingStage enum exactly.
 * 
 * @constant {readonly string[]} PROCESSING_STAGES
 * @property {string} imported - Sequence has been imported but not ready for annotation
 * @property {string} ready_to_annotate - Sequence is ready for human annotation
 * @property {string} annotated - Sequence has been completely annotated
 * 
 * @example
 * ```typescript
 * const isValidStage = PROCESSING_STAGES.includes(sequence.processing_stage);
 * ```
 */
export const PROCESSING_STAGES = ['imported', 'ready_to_annotate', 'annotated'] as const;

/**
 * Processing stage status options including sequences with no annotations.
 * 
 * This extends PROCESSING_STAGES to include the 'no_annotation' status for
 * filtering purposes, allowing users to find sequences that haven't been
 * annotated at all.
 * 
 * @constant {readonly string[]} PROCESSING_STAGE_STATUS_OPTIONS
 * @property {string} no_annotation - Sequence has no annotation record
 * @property {string} imported - Sequence imported but not annotation-ready
 * @property {string} ready_to_annotate - Sequence ready for annotation
 * @property {string} annotated - Sequence completely annotated
 */
export const PROCESSING_STAGE_STATUS_OPTIONS = [
  'no_annotation',
  'imported',
  'ready_to_annotate',
  'annotated',
] as const;

/**
 * Human-readable labels for processing stages.
 * 
 * Maps processing stage enum values to user-friendly display labels
 * for use in UI components like badges, dropdowns, and status indicators.
 * 
 * @constant {Object} PROCESSING_STAGE_LABELS
 * @example
 * ```typescript
 * const label = PROCESSING_STAGE_LABELS[sequence.processing_stage];
 * // Returns: "Ready to annotate"
 * ```
 */
export const PROCESSING_STAGE_LABELS = {
  no_annotation: 'No annotation',
  imported: 'Imported',
  ready_to_annotate: 'Ready to annotate',
  annotated: 'Annotated',
} as const;

/**
 * False positive types for wildfire detection classification.
 * 
 * These values represent different types of false positives that can occur
 * in wildfire detection algorithms. Each type corresponds to environmental
 * or artificial features that might be mistakenly detected as smoke.
 * The values must match exactly with the backend FalsePositiveType enum.
 * 
 * @constant {readonly string[]} FALSE_POSITIVE_TYPES
 * @property {string} antenna - Communication antennas or towers
 * @property {string} building - Buildings or structures
 * @property {string} cliff - Rocky cliffs or geological formations
 * @property {string} dark - Dark objects or shadows
 * @property {string} dust - Dust clouds or particles
 * @property {string} high_cloud - High altitude clouds
 * @property {string} low_cloud - Low altitude clouds or fog
 * @property {string} lens_flare - Camera lens flare artifacts
 * @property {string} lens_droplet - Water droplets on camera lens
 * @property {string} light - Bright lights or reflections
 * @property {string} rain - Rain or precipitation
 * @property {string} trail - Hiking trails or paths
 * @property {string} road - Roads or paved surfaces
 * @property {string} sky - Sky or atmospheric conditions
 * @property {string} tree - Trees or vegetation
 * @property {string} water_body - Lakes, rivers, or other water bodies
 * @property {string} other - Other unspecified false positive types
 * 
 * @example
 * ```typescript
 * const isValidType = FALSE_POSITIVE_TYPES.includes(selectedType);
 * ```
 */
export const FALSE_POSITIVE_TYPES = [
  'antenna',
  'building',
  'cliff',
  'dark',
  'dust',
  'high_cloud',
  'low_cloud',
  'lens_flare',
  'lens_droplet',
  'light',
  'rain',
  'trail',
  'road',
  'sky',
  'tree',
  'water_body',
  'other',
] as const;

/**
 * Smoke types for wildfire detection classification.
 * 
 * These represent the different categories of smoke that can be detected
 * and classified by human annotators. The values must match exactly with
 * the backend SmokeType enum.
 * 
 * @constant {readonly string[]} SMOKE_TYPES
 * @property {string} wildfire - Natural wildfire smoke
 * @property {string} industrial - Industrial or man-made smoke
 * @property {string} other - Other types of smoke or unclear classification
 * 
 * @example
 * ```typescript
 * const smokeType: SmokeType = SMOKE_TYPES[0]; // 'wildfire'
 * ```
 */
export const SMOKE_TYPES = ['wildfire', 'industrial', 'other'] as const;

/**
 * UI layout and styling constants.
 * 
 * These values define consistent spacing, sizing, and styling across
 * the application interface. Changes here will affect the global
 * appearance of UI components.
 * 
 * @constant {Object} UI_CONSTANTS
 * @property {string} SIDEBAR_WIDTH - Width of the application sidebar
 * @property {string} HEADER_HEIGHT - Height of the main header
 * @property {string} CARD_BORDER_RADIUS - Border radius for card components
 * @property {string} ANIMATION_DURATION - Standard animation duration for transitions
 * 
 * @example
 * ```typescript
 * const sidebarStyle = { width: UI_CONSTANTS.SIDEBAR_WIDTH };
 * ```
 */
export const UI_CONSTANTS = {
  SIDEBAR_WIDTH: '256px',
  HEADER_HEIGHT: '64px',
  CARD_BORDER_RADIUS: '8px',
  ANIMATION_DURATION: '200ms',
} as const;

/**
 * File size and upload limits.
 * 
 * These limits prevent excessive resource usage and ensure reasonable
 * performance when handling file uploads and processing.
 * 
 * @constant {Object} FILE_LIMITS
 * @property {number} MAX_IMAGE_SIZE - Maximum allowed image file size in bytes (10MB)
 * 
 * @example
 * ```typescript
 * if (file.size > FILE_LIMITS.MAX_IMAGE_SIZE) {
 *   throw new Error('File too large');
 * }
 * ```
 */
export const FILE_LIMITS = {
  MAX_IMAGE_SIZE: 10 * 1024 * 1024, // 10MB
} as const;

/**
 * Query keys for TanStack Query (React Query) cache management.
 * 
 * These keys define the cache structure for API queries and mutations,
 * enabling consistent cache invalidation, background refetching, and
 * optimistic updates across the application.
 * 
 * @constant {Object} QUERY_KEYS
 * @property {string[]} SEQUENCES - Base key for sequences list queries
 * @property {Function} SEQUENCE - Key factory for individual sequence queries
 * @property {Function} SEQUENCE_DETECTIONS - Key factory for sequence-specific detection queries
 * @property {string[]} DETECTIONS - Base key for detections list queries
 * @property {Function} DETECTION - Key factory for individual detection queries
 * @property {string[]} DETECTION_IMAGE - Base key for detection image queries
 * @property {Function} DETECTION_IMAGE_URL - Key factory for detection image URL queries
 * @property {string[]} SEQUENCE_ANNOTATIONS - Base key for sequence annotation queries
 * @property {Function} SEQUENCE_ANNOTATION - Key factory for individual sequence annotation queries
 * @property {string[]} DETECTION_ANNOTATIONS - Base key for detection annotation queries
 * @property {Function} DETECTION_ANNOTATION - Key factory for individual detection annotation queries
 * @property {string[]} CAMERAS - Base key for cameras list queries
 * @property {string[]} ORGANIZATIONS - Base key for organizations list queries
 * @property {string[]} SOURCE_APIS - Base key for source APIs list queries
 * @property {string[]} ANNOTATION_STATS - Base key for annotation statistics queries
 * @property {string[]} USERS - Base key for users list queries
 * @property {Function} USER - Key factory for individual user queries
 * 
 * @example
 * ```typescript
 * // Using base keys for list queries
 * const { data: sequences } = useQuery({
 *   queryKey: QUERY_KEYS.SEQUENCES,
 *   queryFn: fetchSequences
 * });
 * 
 * // Using key factories for specific items
 * const { data: sequence } = useQuery({
 *   queryKey: QUERY_KEYS.SEQUENCE(123),
 *   queryFn: () => fetchSequence(123)
 * });
 * 
 * // Invalidating related queries
 * await queryClient.invalidateQueries({
 *   queryKey: QUERY_KEYS.SEQUENCES
 * });
 * ```
 */
export const QUERY_KEYS = {
  SEQUENCES: ['sequences'],
  SEQUENCE: (id: number) => ['sequences', id],
  SEQUENCE_DETECTIONS: (sequenceId: number) => ['sequences', sequenceId, 'detections'],
  DETECTIONS: ['detections'],
  DETECTION: (id: number) => ['detections', id],
  DETECTION_IMAGE: ['detection-image'],
  DETECTION_IMAGE_URL: (detectionId: number) => ['detections', detectionId, 'image-url'],
  SEQUENCE_ANNOTATIONS: ['sequence-annotations'],
  SEQUENCE_ANNOTATION: (id: number) => ['sequence-annotations', id],
  DETECTION_ANNOTATIONS: ['detection-annotations'],
  CAMERAS: ['cameras'],
  ORGANIZATIONS: ['organizations'],
  SOURCE_APIS: ['source-apis'],
  DETECTION_ANNOTATION: (id: number) => ['detection-annotations', id],
  ANNOTATION_STATS: ['annotation-stats'],
  USERS: ['users'],
  USER: (id: number) => ['users', id],
} as const;

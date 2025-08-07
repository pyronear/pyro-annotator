// Annotation Labels - based on API SmokeType and FalsePositiveType enums
export const SMOKE_LABELS = [
  'wildfire',
  'industrial', 
  'other',
] as const;

export const FALSE_POSITIVE_LABELS = [
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

export type SmokeLabel = typeof SMOKE_LABELS[number];
export type FalsePositiveLabel = typeof FALSE_POSITIVE_LABELS[number];

// Combined annotation options for UI
export const ANNOTATION_OPTIONS = {
  SMOKE: SMOKE_LABELS,
  FALSE_POSITIVE: FALSE_POSITIVE_LABELS,
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  SEQUENCES: '/sequences',
  SEQUENCE_ANNOTATIONS: '/annotations/sequences',
  DETECTION_ANNOTATIONS: '/annotations/detections',
  DETECTIONS: '/detections',
} as const;

// Pagination defaults
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  SIZE: 20,
  MAX_SIZE: 100,
} as const;

// Source API types
export const SOURCE_APIS = [
  'pyronear_french',
  'alert_wildfire', 
  'api_cenia',
] as const;

// Processing stages
export const PROCESSING_STAGES = [
  'imported',
  'ready_to_annotate', 
  'annotated',
] as const;

// Processing stage status options (including no annotation case)
export const PROCESSING_STAGE_STATUS_OPTIONS = [
  'no_annotation',
  'imported',
  'ready_to_annotate', 
  'annotated',
] as const;

export const PROCESSING_STAGE_LABELS = {
  'no_annotation': 'No annotation',
  'imported': 'Imported',
  'ready_to_annotate': 'Ready to annotate',
  'annotated': 'Annotated',
} as const;

// Smoke types
export const SMOKE_TYPES = [
  'wildfire',
  'industrial',
  'other',
] as const;

// False positive types (matching backend enum)
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

// UI Constants
export const UI_CONSTANTS = {
  SIDEBAR_WIDTH: '256px',
  HEADER_HEIGHT: '64px',
  CARD_BORDER_RADIUS: '8px',
  ANIMATION_DURATION: '200ms',
} as const;

// File size limits
export const FILE_LIMITS = {
  MAX_GIF_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_IMAGE_SIZE: 10 * 1024 * 1024, // 10MB
} as const;

// Query keys for React Query
export const QUERY_KEYS = {
  SEQUENCES: ['sequences'],
  SEQUENCE: (id: number) => ['sequences', id],
  DETECTIONS: ['detections'],
  DETECTION: (id: number) => ['detections', id],
  DETECTION_IMAGE: ['detection-image'],
  SEQUENCE_ANNOTATIONS: ['sequence-annotations'],
  SEQUENCE_ANNOTATION: (id: number) => ['sequence-annotations', id],
  DETECTION_ANNOTATIONS: ['detection-annotations'],
  DETECTION_ANNOTATION: (id: number) => ['detection-annotations', id],
  GIF_URLS: (annotationId: number) => ['gif-urls', annotationId],
  ANNOTATION_STATS: ['annotation-stats'],
} as const;
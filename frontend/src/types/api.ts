// API Response Types - Generated from backend OpenAPI schema

export interface Sequence {
  id: number;
  source_api: 'pyronear_french' | 'alert_wildfire' | 'api_cenia';
  alert_api_id: number;
  created_at: string;
  recorded_at: string;
  last_seen_at: string;
  camera_name: string;
  camera_id: number;
  lat: number;
  lon: number;
  azimuth: number | null;
  is_wildfire_alertapi: boolean | null;
  organisation_name: string;
  organisation_id: number;
}

export interface Detection {
  id: number;
  sequence_id: number;
  alert_api_id: number;
  created_at: string;
  recorded_at: string;
  algo_predictions: AlgoPredictions;
  last_modified_at: string | null;
}

export interface SequenceAnnotation {
  id: number;
  sequence_id: number;
  has_smoke: boolean;
  has_false_positives: boolean;
  false_positive_types: string;
  has_missed_smoke: boolean;
  annotation: SequenceAnnotationData;
  processing_stage: ProcessingStage;
  created_at: string;
  updated_at: string | null;
}

export interface SequenceAnnotationData {
  sequences_bbox: SequenceBbox[];
}

export interface SequenceBbox {
  is_smoke: boolean;
  false_positive_types: FalsePositiveType[];
  gif_key_main?: string;
  gif_key_crop?: string;
  bboxes: BoundingBox[];
}

export interface BoundingBox {
  detection_id: number;
  xyxyn: [number, number, number, number];
}

export interface AlgoPrediction {
  xyxyn: [number, number, number, number];
  confidence: number;
  class_name: string;
}

export interface AlgoPredictions {
  predictions: AlgoPrediction[];
}

export interface DetectionAnnotation {
  id: number;
  detection_id: number;
  annotation: DetectionAnnotationData;
  processing_stage: ProcessingStage;
  created_at: string;
  updated_at: string | null;
}

export interface DetectionAnnotationData {
  smoke_type?: SmokeType;
  false_positive_type?: FalsePositiveType;
  bbox_xyxyn?: [number, number, number, number];
}

// Enums
export type SmokeType = 'wildfire' | 'industrial' | 'other';

export type FalsePositiveType = 
  | 'antenna'
  | 'building'
  | 'cliff'
  | 'dark'
  | 'dust'
  | 'high_cloud'
  | 'low_cloud'
  | 'lens_flare'
  | 'lens_droplet'
  | 'light'
  | 'rain'
  | 'trail'
  | 'road'
  | 'sky'
  | 'tree'
  | 'water_body'
  | 'other';

export type ProcessingStage = 'imported' | 'ready_to_annotate' | 'annotated';

export type SourceApi = 'pyronear_french' | 'alert_wildfire' | 'api_cenia';

// API Request/Response interfaces
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pages: number;
  size: number;
  total: number;
}

export interface SequenceFilters {
  source_api?: SourceApi;
  camera_id?: number;
  camera_name?: string;
  organisation_id?: number;
  organisation_name?: string;
  is_wildfire_alertapi?: boolean;
  order_by?: 'created_at' | 'recorded_at';
  order_direction?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

export interface SequenceAnnotationFilters {
  sequence_id?: number;
  has_smoke?: boolean;
  has_false_positives?: boolean;
  false_positive_type?: FalsePositiveType;
  smoke_type?: SmokeType;
  has_missed_smoke?: boolean;
  processing_stage?: ProcessingStage;
  order_by?: 'created_at' | 'sequence_recorded_at';
  order_direction?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

export interface DetectionAnnotationFilters {
  sequence_id?: number;
  camera_id?: number;
  organisation_id?: number;
  processing_stage?: ProcessingStage;
  order_by?: 'created_at' | 'processing_stage';
  order_direction?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

// GIF Generation
export interface GifUrls {
  main_gif_url?: string;
  crop_gif_url?: string;
  expires_at: string;
}

// Enhanced GIF URLs Response (matches actual API)
export interface GifUrlsResponse {
  annotation_id: number;
  sequence_id: number;
  total_bboxes: number;
  gif_urls: GifBboxUrls[];
  generated_at: string;
}

export interface GifBboxUrls {
  bbox_index: number;
  main_url?: string;
  crop_url?: string;
  main_expires_at: string;
  crop_expires_at: string;
  has_main: boolean;
  has_crop: boolean;
}

// Processing stage status including "no annotation" case
export type ProcessingStageStatus = ProcessingStage | 'no_annotation';

// Extended filters for sequences with full annotation support
export interface ExtendedSequenceFilters extends SequenceFilters {
  processing_stage?: ProcessingStageStatus;
  has_missed_smoke?: boolean;
  has_smoke?: boolean;
  has_false_positives?: boolean;
  include_annotation?: boolean;
}

// Sequence with complete annotation information
export interface SequenceWithAnnotation extends Sequence {
  annotation?: SequenceAnnotation; // Complete annotation object with all fields
}

// Camera and Organization types for dedicated endpoints
export interface Camera {
  id: number;
  name: string;
  sequence_count: number;
  latest_sequence_date: string | null;
}

export interface Organization {
  id: number;
  name: string;
  sequence_count: number;
  latest_sequence_date: string | null;
}

// Legacy interface for backward compatibility (to be removed after migration)
export interface SequenceWithProcessingStage extends Sequence {
  processing_stage_status: ProcessingStageStatus;
  annotation_id?: number;
}

// API Error Response
export interface ApiError {
  detail: string | Record<string, string[]>;
}
// API Response Types - Generated from backend OpenAPI schema

export interface Contributor {
  id: number;
  username: string;
}

export interface Sequence {
  id: number;
  source_api: string;
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
  detection_annotation_stats?: DetectionAnnotationStats;
}

export interface Detection {
  id: number;
  sequence_id: number;
  alert_api_id: number;
  created_at: string;
  recorded_at: string;
  algo_predictions: AlgoPredictions;
  last_modified_at: string | null;
  confidence?: number;
}

export interface SequenceAnnotation {
  id: number;
  sequence_id: number;
  has_smoke: boolean;
  has_false_positives: boolean;
  false_positive_types: string;
  smoke_types: string[];
  has_missed_smoke: boolean;
  is_unsure: boolean;
  annotation: SequenceAnnotationData;
  processing_stage: ProcessingStage;
  created_at: string;
  updated_at: string | null;
  contributors?: Contributor[];
}

export interface SequenceAnnotationData {
  sequences_bbox: SequenceBbox[];
}

export interface SequenceBbox {
  is_smoke: boolean;
  smoke_type?: SmokeType;
  false_positive_types: FalsePositiveType[];
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
  processing_stage: DetectionProcessingStage;
  created_at: string;
  updated_at: string | null;
  contributors?: Contributor[];
}

export interface DetectionAnnotationBbox {
  xyxyn: [number, number, number, number];
  class_name: string;
  smoke_type: SmokeType;
}

export interface DetectionAnnotationData {
  annotation: DetectionAnnotationBbox[];
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

// Detection-specific processing stages  
export type DetectionProcessingStage = 'imported' | 'visual_check' | 'bbox_annotation' | 'annotated';


// API Request/Response interfaces
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pages: number;
  size: number;
  total: number;
}

export interface SequenceFilters {
  source_api?: string;
  camera_id?: number;
  camera_name?: string;
  organisation_id?: number;
  organisation_name?: string;
  is_wildfire_alertapi?: boolean;
  recorded_at_gte?: string;
  recorded_at_lte?: string;
  detection_annotation_completion?: 'complete' | 'incomplete' | 'all';
  include_detection_stats?: boolean;
  is_unsure?: boolean;
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
  is_unsure?: boolean;
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


// Processing stage status including "no annotation" case
export type ProcessingStageStatus = ProcessingStage | 'no_annotation';

// Extended filters for sequences with full annotation support
export interface ExtendedSequenceFilters extends SequenceFilters {
  processing_stage?: ProcessingStageStatus;
  has_missed_smoke?: boolean;
  has_smoke?: boolean;
  has_false_positives?: boolean;
  false_positive_types?: string[]; // Array of false positive types for OR filtering
  smoke_types?: string[]; // Array of smoke types for OR filtering
  is_unsure?: boolean;
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
}

export interface Organization {
  id: number;
  name: string;
}

export interface SourceApi {
  id: string;
  name: string;
}

// Legacy interface for backward compatibility (to be removed after migration)
export interface SequenceWithProcessingStage extends Sequence {
  processing_stage_status: ProcessingStageStatus;
  annotation_id?: number;
}

// Detection annotation progress statistics
export interface DetectionAnnotationStats {
  total_detections: number;
  annotated_detections: number;
  completion_percentage: number;
  pending_stages: string[];
}

// Sequence with detection annotation progress
export interface SequenceWithDetectionProgress extends Sequence {
  detection_annotation_stats?: DetectionAnnotationStats;
}

// User Management Types
export interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
  updated_at?: string;
}

export interface UserCreate {
  username: string;
  email: string;
  password: string;
  is_active?: boolean;
  is_superuser?: boolean;
}

export interface UserUpdate {
  username?: string;
  email?: string;
  is_active?: boolean;
  is_superuser?: boolean;
}

export interface UserPasswordUpdate {
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface UserFilters {
  is_active?: boolean;
  is_superuser?: boolean;
  search?: string;
  page?: number;
  size?: number;
}

// API Error Response
export interface ApiError {
  detail: string | Record<string, string[]>;
}
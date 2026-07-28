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
  is_wildfire_alertapi: AnnotationType | null;
  organisation_name: string;
  organisation_id: number;
  // Membership in a SequenceGroup; null until the periodic assignment
  // sweep runs or when the sequence has been excluded from grouping manually.
  sequence_group_id?: number | null;
  detection_annotation_stats?: DetectionAnnotationStats;
}

export interface Detection {
  id: number;
  sequence_id: number;
  alert_api_id: number;
  created_at: string;
  recorded_at: string;
  algo_predictions: AlgoPredictions;
  // Immutable local high-precision model output, written by the auto-annotate
  // worker. Read-only reference layer in the review canvas; the winning model
  // layer (auto if present, else engine) seeds the human annotation at submit.
  // Null until the worker has run.
  auto_predictions?: AlgoPredictions | null;
  // Sibling boxes detected on the same image but not part of the tracked
  // sequence. Read-only — annotators see them as a hint for missed smoke,
  // and they are NOT fed into auto-annotation. Null on legacy detections.
  others_bboxes?: AlgoPredictions | null;
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
  // Set when the annotation belongs to a validated SequenceGroup but
  // fan-out to the rest of the group was skipped (e.g. the group already
  // carries a different label). The annotation itself was saved; the
  // operator must reconcile the conflict manually.
  group_propagation_warning?: string | null;
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

// Provenance of a committed detection box: accepted-from-model (unedited) vs
// hand-drawn/adjusted. Lets us measure model quality (accepted vs corrected vs
// missed) against the immutable algo_predictions / auto_predictions.
export type AnnotationOrigin = 'auto' | 'engine' | 'human';

export interface DetectionAnnotationBbox {
  xyxyn: [number, number, number, number];
  class_name: string;
  // exactly one of smoke_type / false_positive_type is set
  smoke_type?: SmokeType | null;
  false_positive_type?: FalsePositiveType | null;
  origin?: AnnotationOrigin;
}

export interface DetectionAnnotationData {
  annotation: DetectionAnnotationBbox[];
  smoke_type?: SmokeType;
  false_positive_type?: FalsePositiveType;
  bbox_xyxyn?: [number, number, number, number];
}

export interface SequenceGroupRepresentativeBbox {
  xyxyn: [number, number, number, number];
  confidence: number;
}

export interface SequenceGroupMember {
  sequence_id: number;
  alert_api_id: number;
  camera_name: string;
  recorded_at: string;
  last_seen_at: string;
  // null when no SequenceAnnotation row exists. READY_TO_ANNOTATE is the
  // placeholder import.py creates; only SEQ_ANNOTATION_DONE+ counts as
  // human-submitted work in the UI.
  annotation_processing_stage: string | null;
  first_detection_id: number | null;
  first_detection_algo_predictions: AlgoPredictions | null;
}

export interface SequenceGroupListItem {
  id: number;
  camera_id: number;
  camera_name: string;
  azimuth: number;
  representative_bbox: SequenceGroupRepresentativeBbox;
  smoke_type: SmokeType | null;
  false_positive_type: FalsePositiveType | null;
  is_unsure: boolean;
  is_validated: boolean;
  labeled_at: string | null;
  created_at: string;
  member_count: number;
}

export interface SequenceGroupStats {
  total: number;
  validated: number;
  unvalidated: number;
  labeled: number;
  unlabeled: number;
}

export interface SequenceGroup {
  id: number;
  camera_id: number;
  azimuth: number;
  representative_bbox: SequenceGroupRepresentativeBbox;
  smoke_type: SmokeType | null;
  false_positive_type: FalsePositiveType | null;
  is_unsure: boolean;
  is_validated: boolean;
  labeled_at: string | null;
  labeled_by_user_id: number | null;
  created_at: string;
  updated_at: string | null;
  members: SequenceGroupMember[];
}

// Enums
export type SmokeType = 'wildfire' | 'industrial' | 'other';

export type AnnotationType = 'wildfire_smoke' | 'other_smoke' | 'other';

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
  | 'other'
  | 'unlabeled';

export type ProcessingStage =
  | 'imported'
  | 'ready_to_annotate'
  | 'under_annotation'
  | 'seq_annotation_done'
  | 'in_review'
  | 'needs_manual'
  | 'annotated';

// Detection-specific processing stages
export type DetectionProcessingStage =
  | 'imported'
  | 'visual_check'
  | 'bbox_annotation'
  | 'annotated';

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
  is_wildfire_alertapi?: AnnotationType | null;
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
  is_active: boolean;
  is_superuser: boolean;
  is_system: boolean;
  created_at: string;
  updated_at?: string;
}

export interface UserCreate {
  username: string;
  password: string;
  is_active?: boolean;
  is_superuser?: boolean;
}

export interface UserUpdate {
  username?: string;
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

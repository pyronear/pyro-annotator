/**
 * Unit tests for validation utilities.
 * These tests verify annotation validation, completeness checking, and workflow validation.
 */

import { describe, it, expect } from 'vitest';
import {
  validateDetectionPredictions,
  validateDrawnRectangles,
  validateDetectionAnnotation,
  isDetectionAnnotationComplete,
  calculateAnnotationCompleteness,
  validateRectangleOverlaps,
  calculateBoundingBoxOverlap,
  validateWorkflowReadiness
} from '@/utils/annotation/validationUtils';
import { DrawnRectangle } from '@/utils/annotation/drawingUtils';
import { Detection, DetectionAnnotation } from '@/types/api';

describe('validationUtils', () => {
  describe('validateDetectionPredictions', () => {
    it('should validate detection with valid predictions', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: [
            {
              xyxyn: [0.1, 0.2, 0.8, 0.9],
              confidence: 0.95,
              class_name: 'smoke'
            }
          ]
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should fail validation when detection has no algo_predictions', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: null
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Detection has no algorithm predictions');
    });

    it('should warn when predictions array is empty', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: []
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Detection has empty predictions array');
    });

    it('should fail validation for invalid xyxyn coordinates', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: [
            {
              xyxyn: [0.1, 0.2, 1.5], // Invalid: only 3 coordinates and x2 > 1
              confidence: 0.95,
              class_name: 'smoke'
            }
          ]
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Prediction 0 has invalid xyxyn coordinates');
    });

    it('should fail validation for coordinates outside 0-1 range', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: [
            {
              xyxyn: [-0.1, 0.2, 0.8, 1.2], // Invalid: coordinates outside 0-1
              confidence: 0.95,
              class_name: 'smoke'
            }
          ]
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Prediction 0 has coordinates outside 0-1 range');
    });

    it('should fail validation for invalid bbox dimensions', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: [
            {
              xyxyn: [0.8, 0.9, 0.1, 0.2], // Invalid: x2 < x1, y2 < y1
              confidence: 0.95,
              class_name: 'smoke'
            }
          ]
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Prediction 0 has invalid bbox dimensions (x2=0.1, x1=0.8, y2=0.2, y1=0.9)');
    });

    it('should fail validation for invalid confidence scores', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: [
            {
              xyxyn: [0.1, 0.2, 0.8, 0.9],
              confidence: 1.5, // Invalid: > 1
              class_name: 'smoke'
            }
          ]
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Prediction 0 has invalid confidence score');
    });

    it('should fail validation for invalid class names', () => {
      const detection: Detection = {
        id: 1,
        sequence_id: 1,
        bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
        confidence: 0.95,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        algo_predictions: {
          predictions: [
            {
              xyxyn: [0.1, 0.2, 0.8, 0.9],
              confidence: 0.95,
              class_name: '' // Invalid: empty string
            }
          ]
        }
      };

      const result = validateDetectionPredictions(detection);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Prediction 0 has invalid class name');
    });
  });

  describe('validateDrawnRectangles', () => {
    it('should validate valid drawn rectangles', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '1',
          xyxyn: [0.1, 0.2, 0.8, 0.9],
          smokeType: 'wildfire'
        },
        {
          id: '2',
          xyxyn: [0.2, 0.1, 0.9, 0.8],
          smokeType: 'industrial'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for invalid rectangle ID', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '',
          xyxyn: [0.1, 0.2, 0.8, 0.9],
          smokeType: 'wildfire'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Rectangle 0 has invalid ID');
    });

    it('should fail validation for invalid coordinates', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '1',
          xyxyn: [0.1, 0.2, 1.5] as [number, number, number], // Invalid: wrong length
          smokeType: 'wildfire'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Rectangle 0 has invalid xyxyn coordinates');
    });

    it('should fail validation for coordinates outside range', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '1',
          xyxyn: [-0.1, 0.2, 0.8, 1.2],
          smokeType: 'wildfire'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Rectangle 0 has coordinates outside 0-1 range');
    });

    it('should fail validation for invalid dimensions', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '1',
          xyxyn: [0.8, 0.9, 0.1, 0.2], // x2 < x1, y2 < y1
          smokeType: 'wildfire'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Rectangle 0 has invalid dimensions (x2=0.1, x1=0.8, y2=0.2, y1=0.9)');
    });

    it('should warn for very small rectangles', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '1',
          xyxyn: [0.1, 0.2, 0.105, 0.205], // 0.5% x 0.5% rectangle
          smokeType: 'wildfire'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Rectangle 0 is very small (0.5% × 0.5%)');
    });

    it('should fail validation for invalid smoke type', () => {
      const rectangles: DrawnRectangle[] = [
        {
          id: '1',
          xyxyn: [0.1, 0.2, 0.8, 0.9],
          smokeType: 'invalid' as 'wildfire'
        }
      ];

      const result = validateDrawnRectangles(rectangles);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Rectangle 0 has invalid smoke type: invalid');
    });
  });

  describe('validateDetectionAnnotation', () => {
    it('should validate valid detection annotation', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: {
          annotation: [
            {
              xyxyn: [0.1, 0.2, 0.8, 0.9],
              smoke_type: 'wildfire'
            }
          ]
        },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for invalid detection_id', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 'invalid' as unknown as number,
        annotation: {
          annotation: []
        },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Annotation has invalid detection_id');
    });

    it('should fail validation for missing annotation data', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: null as unknown as object,
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Annotation has no annotation data');
    });

    it('should fail validation for invalid annotation structure', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: {
          annotation: 'invalid' as unknown as object
        },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Annotation data has invalid structure');
    });

    it('should fail validation for invalid annotation item coordinates', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: {
          annotation: [
            {
              xyxyn: [0.1, 0.2] as [number, number], // Invalid: wrong length
              smoke_type: 'wildfire'
            }
          ]
        },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Annotation item 0 has invalid xyxyn coordinates');
    });

    it('should fail validation for invalid smoke type', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: {
          annotation: [
            {
              xyxyn: [0.1, 0.2, 0.8, 0.9],
              smoke_type: 'invalid' as 'wildfire'
            }
          ]
        },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Annotation item 0 has invalid smoke type: invalid');
    });

    it('should warn for empty annotation array', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: {
          annotation: []
        },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = validateDetectionAnnotation(annotation);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Annotation has empty annotation array - this might indicate a false positive');
    });
  });

  describe('isDetectionAnnotationComplete', () => {
    it('should return false for null annotation', () => {
      const result = isDetectionAnnotationComplete(null);
      expect(result).toBe(false);
    });

    it('should return true for annotated stage', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: { annotation: [] },
        processing_stage: 'annotated',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = isDetectionAnnotationComplete(annotation);
      expect(result).toBe(true);
    });

    it('should return false for non-annotated stages', () => {
      const annotation: DetectionAnnotation = {
        id: 1,
        detection_id: 1,
        annotation: { annotation: [] },
        processing_stage: 'in_progress',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = isDetectionAnnotationComplete(annotation);
      expect(result).toBe(false);
    });
  });

  describe('calculateAnnotationCompleteness', () => {
    it('should calculate completeness correctly', () => {
      const detections: Detection[] = [
        {
          id: 1,
          sequence_id: 1,
          bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
          confidence: 0.95,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          algo_predictions: null
        },
        {
          id: 2,
          sequence_id: 1,
          bbox_coordinates: [0.2, 0.1, 0.9, 0.8],
          confidence: 0.88,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          algo_predictions: null
        }
      ];

      const annotations = new Map<number, DetectionAnnotation>([
        [1, {
          id: 1,
          detection_id: 1,
          annotation: { annotation: [] },
          processing_stage: 'annotated',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]
      ]);

      const result = calculateAnnotationCompleteness(detections, annotations);

      expect(result.totalDetections).toBe(2);
      expect(result.annotatedDetections).toBe(1);
      expect(result.completionPercentage).toBe(50);
      expect(result.isComplete).toBe(false);
      expect(result.hasAnnotations).toBe(true);
    });

    it('should handle empty datasets', () => {
      const detections: Detection[] = [];
      const annotations = new Map<number, DetectionAnnotation>();

      const result = calculateAnnotationCompleteness(detections, annotations);

      expect(result.totalDetections).toBe(0);
      expect(result.annotatedDetections).toBe(0);
      expect(result.completionPercentage).toBe(0);
      expect(result.isComplete).toBe(true); // When there are 0 detections, 0/0 is considered complete
      expect(result.hasAnnotations).toBe(false);
    });
  });

  describe('calculateBoundingBoxOverlap', () => {
    it('should calculate no overlap for non-intersecting boxes', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.1, 0.4, 0.4];
      const bbox2: [number, number, number, number] = [0.6, 0.6, 0.9, 0.9];

      const overlap = calculateBoundingBoxOverlap(bbox1, bbox2);
      expect(overlap).toBe(0);
    });

    it('should calculate partial overlap', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.1, 0.6, 0.6];
      const bbox2: [number, number, number, number] = [0.4, 0.4, 0.9, 0.9];

      const overlap = calculateBoundingBoxOverlap(bbox1, bbox2);
      expect(overlap).toBeCloseTo(0.087, 3); // Intersection area / union area
    });

    it('should calculate complete overlap for identical boxes', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.1, 0.9, 0.9];
      const bbox2: [number, number, number, number] = [0.1, 0.1, 0.9, 0.9];

      const overlap = calculateBoundingBoxOverlap(bbox1, bbox2);
      expect(overlap).toBe(1);
    });

    it('should handle edge-adjacent boxes', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.1, 0.5, 0.5];
      const bbox2: [number, number, number, number] = [0.5, 0.5, 0.9, 0.9];

      const overlap = calculateBoundingBoxOverlap(bbox1, bbox2);
      expect(overlap).toBe(0); // No area intersection at edges
    });
  });

  describe('validateRectangleOverlaps', () => {
    it('should pass validation for non-overlapping rectangles', () => {
      const rectangles: DrawnRectangle[] = [
        { id: '1', xyxyn: [0.1, 0.1, 0.4, 0.4], smokeType: 'wildfire' },
        { id: '2', xyxyn: [0.6, 0.6, 0.9, 0.9], smokeType: 'industrial' }
      ];

      const result = validateRectangleOverlaps(rectangles);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn for high overlap rectangles', () => {
      const rectangles: DrawnRectangle[] = [
        { id: '1', xyxyn: [0.1, 0.1, 0.9, 0.9], smokeType: 'wildfire' },
        { id: '2', xyxyn: [0.15, 0.15, 0.85, 0.85], smokeType: 'industrial' } // High overlap
      ];

      const result = validateRectangleOverlaps(rectangles, 0.5);

      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('have high overlap');
    });

    it('should use custom overlap threshold', () => {
      const rectangles: DrawnRectangle[] = [
        { id: '1', xyxyn: [0.1, 0.1, 0.6, 0.6], smokeType: 'wildfire' },
        { id: '2', xyxyn: [0.4, 0.4, 0.9, 0.9], smokeType: 'industrial' }
      ];

      const result = validateRectangleOverlaps(rectangles, 0.05); // Very low threshold

      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateWorkflowReadiness', () => {
    const createDetection = (id: number): Detection => ({
      id,
      sequence_id: 1,
      bbox_coordinates: [0.1, 0.2, 0.8, 0.9],
      confidence: 0.95,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      algo_predictions: null
    });

    const createAnnotation = (id: number, detectionId: number, complete: boolean = true): DetectionAnnotation => ({
      id,
      detection_id: detectionId,
      annotation: {
        annotation: [
          { xyxyn: [0.1, 0.2, 0.8, 0.9], smoke_type: 'wildfire' }
        ]
      },
      processing_stage: complete ? 'annotated' : 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    it('should validate ready workflow', () => {
      const detections = [createDetection(1), createDetection(2)];
      const annotations = new Map([
        [1, createAnnotation(1, 1)],
        [2, createAnnotation(2, 2)]
      ]);

      const result = validateWorkflowReadiness(detections, annotations, true);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when not all detections are annotated', () => {
      const detections = [createDetection(1), createDetection(2)];
      const annotations = new Map([
        [1, createAnnotation(1, 1)]
      ]);

      const result = validateWorkflowReadiness(detections, annotations, true);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Not all detections are annotated (1/2)');
    });

    it('should fail validation when no annotations exist', () => {
      const detections = [createDetection(1)];
      const annotations = new Map();

      const result = validateWorkflowReadiness(detections, annotations, false);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('No annotations have been created');
    });

    it('should allow partial completion when requireAllAnnotated is false', () => {
      const detections = [createDetection(1), createDetection(2)];
      const annotations = new Map([
        [1, createAnnotation(1, 1)]
      ]);

      const result = validateWorkflowReadiness(detections, annotations, false);

      expect(result.isValid).toBe(true);
    });

    it('should fail validation for invalid annotation', () => {
      const detections = [createDetection(1)];
      const invalidAnnotation = createAnnotation(1, 1);
      invalidAnnotation.annotation = null as unknown as object; // Make it invalid

      const annotations = new Map([
        [1, invalidAnnotation]
      ]);

      const result = validateWorkflowReadiness(detections, annotations, true);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('Detection 1:'))).toBe(true);
    });
  });
});
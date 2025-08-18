/**
 * Pure utility functions for detection table formatting and processing
 * 
 * These functions provide functional operations for detection data display,
 * formatting, and table state management without side effects.
 */

import { SequenceWithDetectionProgress, ExtendedSequenceFilters } from '@/types/api';
import { 
  analyzeSequenceAccuracy,
  getRowBackgroundClasses,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  ModelAccuracyType 
} from '@/utils/modelAccuracy';

/**
 * Detection table row data interface
 */
export interface DetectionTableRow {
  readonly id: number;
  readonly sequenceId: number;
  readonly thumbnailUrl?: string;
  readonly cameraName: string;
  readonly organizationName: string;
  readonly recordedAt: string;
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly detectionProgress: {
    readonly completed: number;
    readonly total: number;
    readonly percentage: number;
  };
  readonly accuracy: {
    readonly type: ModelAccuracyType;
    readonly label: string;
    readonly confidence: number;
  };
  readonly rowClasses: string;
  readonly isCompleted: boolean;
  readonly hasPredictions: boolean;
}

/**
 * Detection table state interface
 */
export interface DetectionTableState {
  readonly data: readonly DetectionTableRow[];
  readonly totalRows: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly currentPage: number;
  readonly pageSize: number;
}

/**
 * Formats a date string for display in detection table
 * 
 * @pure Function formats date without side effects
 * @param dateString - ISO date string
 * @returns Formatted date object with separate date and time
 * 
 * @example
 * const formatted = formatDetectionDate('2024-01-15T10:30:00Z');
 * // Returns: { date: '2024-01-15', time: '10:30', combined: '2024-01-15 10:30' }
 */
export const formatDetectionDate = (dateString: string): {
  readonly date: string;
  readonly time: string;
  readonly combined: string;
} => {
  const date = new Date(dateString);
  const dateStr = date.toLocaleDateString('en-CA'); // YYYY-MM-DD format
  const timeStr = date.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  
  return {
    date: dateStr,
    time: timeStr,
    combined: `${dateStr} ${timeStr}`
  };
};

/**
 * Calculates detection progress metrics
 * 
 * @pure Function computes progress without side effects
 * @param sequence - Sequence with detection statistics
 * @returns Progress metrics object
 * 
 * @example
 * const progress = calculateDetectionProgress(sequence);
 * // Returns: { completed: 5, total: 10, percentage: 50 }
 */
export const calculateDetectionProgress = (sequence: SequenceWithDetectionProgress): {
  readonly completed: number;
  readonly total: number;
  readonly percentage: number;
} => {
  const stats = sequence.detection_annotation_stats;
  
  if (!stats) {
    return { completed: 0, total: 0, percentage: 0 };
  }
  
  const total = stats.total_detections || 0;
  const completed = stats.annotated_detections || 0;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return { completed, total, percentage };
};

/**
 * Analyzes sequence accuracy for table display
 * 
 * @pure Function analyzes accuracy without side effects
 * @param sequence - Sequence to analyze
 * @returns Accuracy analysis result
 * 
 * @example
 * const accuracy = analyzeSequenceAccuracyForTable(sequence);
 * // Returns: { type: 'high', label: 'High Accuracy', confidence: 0.85 }
 */
export const analyzeSequenceAccuracyForTable = (sequence: SequenceWithDetectionProgress): {
  readonly type: ModelAccuracyType;
  readonly label: string;
  readonly confidence: number;
} => {
  const analysis = analyzeSequenceAccuracy(sequence);
  
  return {
    type: analysis.accuracy,
    label: analysis.label,
    confidence: analysis.averageConfidence
  };
};

/**
 * Transforms sequence data to table row format
 * 
 * @pure Function transforms data without side effects
 * @param sequence - Raw sequence data
 * @param index - Row index for key generation
 * @returns Formatted table row data
 * 
 * @example
 * const row = transformSequenceToTableRow(sequence, 0);
 */
export const transformSequenceToTableRow = (
  sequence: SequenceWithDetectionProgress,
  index: number
): DetectionTableRow => {
  const formattedDate = formatDetectionDate(sequence.recorded_at);
  const progress = calculateDetectionProgress(sequence);
  const accuracy = analyzeSequenceAccuracyForTable(sequence);
  const rowClasses = getRowBackgroundClasses(accuracy.type);
  
  return {
    id: sequence.id,
    sequenceId: sequence.id,
    cameraName: sequence.camera_name,
    organizationName: sequence.organisation_name,
    recordedAt: sequence.recorded_at,
    formattedDate: formattedDate.date,
    formattedTime: formattedDate.time,
    detectionProgress: progress,
    accuracy,
    rowClasses,
    isCompleted: progress.percentage === 100,
    hasPredictions: progress.total > 0
  };
};

/**
 * Transforms array of sequences to table rows
 * 
 * @pure Function transforms array without side effects
 * @param sequences - Array of sequence data
 * @returns Array of formatted table rows
 * 
 * @example
 * const rows = transformSequencesToTableRows(sequences);
 */
export const transformSequencesToTableRows = (
  sequences: readonly SequenceWithDetectionProgress[]
): readonly DetectionTableRow[] => {
  return sequences.map((sequence, index) => transformSequenceToTableRow(sequence, index));
};

/**
 * Filters table rows based on search criteria
 * 
 * @pure Function filters data without side effects
 * @param rows - Array of table rows
 * @param searchTerm - Search string to match against
 * @returns Filtered array of table rows
 * 
 * @example
 * const filtered = filterDetectionTableRows(rows, 'camera-1');
 */
export const filterDetectionTableRows = (
  rows: readonly DetectionTableRow[],
  searchTerm: string
): readonly DetectionTableRow[] => {
  if (!searchTerm.trim()) {
    return rows;
  }
  
  const term = searchTerm.toLowerCase();
  
  return rows.filter(row => 
    row.cameraName.toLowerCase().includes(term) ||
    row.organizationName.toLowerCase().includes(term) ||
    row.formattedDate.includes(term) ||
    row.id.toString().includes(term)
  );
};

/**
 * Sorts table rows by specified field and direction
 * 
 * @pure Function sorts data without mutation
 * @param rows - Array of table rows
 * @param field - Field to sort by
 * @param direction - Sort direction
 * @returns Sorted array of table rows
 * 
 * @example
 * const sorted = sortDetectionTableRows(rows, 'recordedAt', 'desc');
 */
export const sortDetectionTableRows = (
  rows: readonly DetectionTableRow[],
  field: keyof DetectionTableRow,
  direction: 'asc' | 'desc' = 'asc'
): readonly DetectionTableRow[] => {
  const sortedRows = [...rows];
  
  sortedRows.sort((a, b) => {
    let aValue = a[field];
    let bValue = b[field];
    
    // Handle nested objects
    if (field === 'detectionProgress') {
      aValue = a.detectionProgress.percentage as any;
      bValue = b.detectionProgress.percentage as any;
    } else if (field === 'accuracy') {
      aValue = a.accuracy.confidence as any;
      bValue = b.accuracy.confidence as any;
    }
    
    // Handle different data types
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return direction === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }
    
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return direction === 'asc' ? aValue - bValue : bValue - aValue;
    }
    
    // Handle dates
    if (field === 'recordedAt') {
      const dateA = new Date(aValue as string).getTime();
      const dateB = new Date(bValue as string).getTime();
      return direction === 'asc' ? dateA - dateB : dateB - dateA;
    }
    
    return 0;
  });
  
  return sortedRows;
};

/**
 * Calculates table pagination information
 * 
 * @pure Function computes pagination without side effects
 * @param totalItems - Total number of items
 * @param currentPage - Current page number (1-based)
 * @param pageSize - Number of items per page
 * @returns Pagination information
 * 
 * @example
 * const pagination = calculateTablePagination(100, 3, 20);
 * // Returns: { totalPages: 5, hasNext: true, hasPrevious: true, ... }
 */
export const calculateTablePagination = (
  totalItems: number,
  currentPage: number,
  pageSize: number
) => {
  const totalPages = Math.ceil(totalItems / pageSize);
  const hasNextPage = currentPage < totalPages;
  const hasPreviousPage = currentPage > 1;
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);
  
  return {
    totalPages,
    hasNextPage,
    hasPreviousPage,
    startItem,
    endItem,
    totalItems,
    currentPage,
    pageSize
  } as const;
};

/**
 * Creates table state object from API response
 * 
 * @pure Function creates state without side effects
 * @param sequences - Array of sequences from API
 * @param totalCount - Total number of sequences
 * @param currentPage - Current page number
 * @param pageSize - Number of items per page
 * @param isLoading - Loading state
 * @param error - Error message if any
 * @returns Complete table state object
 * 
 * @example
 * const state = createDetectionTableState(sequences, 100, 1, 20, false, null);
 */
export const createDetectionTableState = (
  sequences: readonly SequenceWithDetectionProgress[],
  totalCount: number,
  currentPage: number,
  pageSize: number,
  isLoading: boolean = false,
  error: string | null = null
): DetectionTableState => {
  const data = transformSequencesToTableRows(sequences);
  const pagination = calculateTablePagination(totalCount, currentPage, pageSize);
  
  return {
    data,
    totalRows: totalCount,
    isLoading,
    error,
    hasNextPage: pagination.hasNextPage,
    hasPreviousPage: pagination.hasPreviousPage,
    currentPage,
    pageSize
  };
};

/**
 * Applies filters to detection table query parameters
 * 
 * @pure Function builds query parameters without side effects
 * @param filters - Current filter values
 * @param dateFrom - Start date filter
 * @param dateTo - End date filter
 * @param modelAccuracy - Model accuracy filter
 * @param falsePositiveTypes - False positive types filter
 * @returns Combined filter object for API query
 * 
 * @example
 * const queryFilters = applyDetectionTableFilters(
 *   baseFilters,
 *   '2024-01-01',
 *   '2024-01-31',
 *   'high',
 *   ['building', 'antenna']
 * );
 */
export const applyDetectionTableFilters = (
  filters: ExtendedSequenceFilters,
  dateFrom: string,
  dateTo: string,
  modelAccuracy: ModelAccuracyType | 'all',
  falsePositiveTypes: readonly string[]
): ExtendedSequenceFilters => {
  const updatedFilters: ExtendedSequenceFilters = { ...filters };
  
  // Apply date range filters
  if (dateFrom) {
    updatedFilters.recorded_at_gte = `${dateFrom}T00:00:00`;
  }
  if (dateTo) {
    updatedFilters.recorded_at_lte = `${dateTo}T23:59:59`;
  }
  
  // Apply model accuracy filter (this would need backend support)
  // For now, we'll filter on the frontend after receiving data
  
  // Apply false positive types filter (this would need backend support)
  // For now, we'll filter on the frontend after receiving data
  
  return updatedFilters;
};

/**
 * Generates table row key for React rendering
 * 
 * @pure Function generates consistent keys without side effects
 * @param row - Table row data
 * @returns Unique key for React rendering
 * 
 * @example
 * const key = generateTableRowKey(row);
 * // Returns: "detection-row-123"
 */
export const generateTableRowKey = (row: DetectionTableRow): string => {
  return `detection-row-${row.id}`;
};

/**
 * Formats detection progress for display
 * 
 * @pure Function formats progress without side effects
 * @param progress - Progress metrics
 * @returns Formatted progress string
 * 
 * @example
 * const formatted = formatDetectionProgressDisplay({ completed: 5, total: 10, percentage: 50 });
 * // Returns: "5 / 10 (50%)"
 */
export const formatDetectionProgressDisplay = (progress: {
  readonly completed: number;
  readonly total: number;
  readonly percentage: number;
}): string => {
  return `${progress.completed} / ${progress.total} (${progress.percentage}%)`;
};

/**
 * Gets CSS classes for progress bar based on completion percentage
 * 
 * @pure Function returns CSS classes without side effects
 * @param percentage - Completion percentage (0-100)
 * @returns CSS class string for progress bar
 * 
 * @example
 * const classes = getProgressBarClasses(75);
 * // Returns: "bg-yellow-500"
 */
export const getProgressBarClasses = (percentage: number): string => {
  if (percentage === 100) {
    return 'bg-green-500';
  } else if (percentage >= 75) {
    return 'bg-yellow-500';
  } else if (percentage >= 50) {
    return 'bg-orange-500';
  } else {
    return 'bg-red-500';
  }
};
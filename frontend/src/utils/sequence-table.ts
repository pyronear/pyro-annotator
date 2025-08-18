/**
 * Pure utility functions for sequence table data processing and formatting
 * 
 * These functions provide functional operations for sequence data display,
 * sorting, filtering, and table state management without side effects.
 */

import { Sequence, SequenceWithAnnotation, ExtendedSequenceFilters, ProcessingStage } from '@/types/api';

/**
 * Sequence table row data interface
 */
export interface SequenceTableRow {
  readonly id: number;
  readonly sourceApi: string;
  readonly cameraName: string;
  readonly organizationName: string;
  readonly recordedAt: string;
  readonly formattedDate: string;
  readonly formattedTime: string;
  readonly location: {
    readonly lat: number;
    readonly lon: number;
    readonly azimuth: number | null;
  };
  readonly isWildfireAlert: boolean | null;
  readonly processingStage: ProcessingStage;
  readonly annotationStatus: {
    readonly hasAnnotation: boolean;
    readonly isComplete: boolean;
    readonly lastUpdated: string | null;
  };
  readonly rowClasses: string;
}

/**
 * Sequence table configuration interface
 */
export interface SequenceTableConfig {
  readonly showProcessingStage: boolean;
  readonly showAnnotationStatus: boolean;
  readonly showLocation: boolean;
  readonly showWildfireAlert: boolean;
  readonly allowSelection: boolean;
  readonly defaultSortField: keyof SequenceTableRow;
  readonly defaultSortDirection: 'asc' | 'desc';
}

/**
 * Sequence table state interface
 */
export interface SequenceTableState {
  readonly data: readonly SequenceTableRow[];
  readonly totalRows: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly selectedIds: readonly number[];
  readonly sortField: keyof SequenceTableRow;
  readonly sortDirection: 'asc' | 'desc';
  readonly searchTerm: string;
  readonly currentPage: number;
  readonly pageSize: number;
}

/**
 * Default table configuration
 * 
 * @pure Constant configuration object
 */
export const DEFAULT_SEQUENCE_TABLE_CONFIG: SequenceTableConfig = {
  showProcessingStage: true,
  showAnnotationStatus: true,
  showLocation: true,
  showWildfireAlert: true,
  allowSelection: false,
  defaultSortField: 'recordedAt',
  defaultSortDirection: 'desc'
} as const;

/**
 * Formats source API name for display
 * 
 * @pure Function formats API name without side effects
 * @param sourceApi - Raw source API identifier
 * @returns Human-readable source API name
 * 
 * @example
 * const formatted = formatSourceApiDisplay('pyronear_french');
 * // Returns: "Pyronear French"
 */
export const formatSourceApiDisplay = (sourceApi: string): string => {
  const apiNames: Record<string, string> = {
    'pyronear_french': 'Pyronear French',
    'alert_wildfire': 'Alert Wildfire',
    'api_cenia': 'API Cenia'
  };
  
  return apiNames[sourceApi] || sourceApi;
};

/**
 * Formats processing stage for display
 * 
 * @pure Function formats processing stage without side effects
 * @param stage - Processing stage identifier
 * @returns Human-readable processing stage name
 * 
 * @example
 * const formatted = formatProcessingStageDisplay('ready_to_annotate');
 * // Returns: "Ready to Annotate"
 */
export const formatProcessingStageDisplay = (stage: ProcessingStage): string => {
  const stageNames: Record<ProcessingStage, string> = {
    'ready_to_annotate': 'Ready to Annotate',
    'in_progress': 'In Progress',
    'annotated': 'Annotated',
    'reviewed': 'Reviewed'
  };
  
  return stageNames[stage] || stage;
};

/**
 * Gets CSS classes for processing stage display
 * 
 * @pure Function returns CSS classes without side effects
 * @param stage - Processing stage
 * @returns CSS class string for stage badge
 * 
 * @example
 * const classes = getProcessingStageClasses('annotated');
 * // Returns: "bg-green-100 text-green-800"
 */
export const getProcessingStageClasses = (stage: ProcessingStage): string => {
  const stageClasses: Record<ProcessingStage, string> = {
    'ready_to_annotate': 'bg-blue-100 text-blue-800',
    'in_progress': 'bg-yellow-100 text-yellow-800',
    'annotated': 'bg-green-100 text-green-800',
    'reviewed': 'bg-purple-100 text-purple-800'
  };
  
  return stageClasses[stage] || 'bg-gray-100 text-gray-800';
};

/**
 * Analyzes annotation status from sequence with annotation
 * 
 * @pure Function analyzes annotation status without side effects
 * @param sequence - Sequence with potential annotation
 * @returns Annotation status object
 * 
 * @example
 * const status = analyzeAnnotationStatus(sequenceWithAnnotation);
 */
export const analyzeAnnotationStatus = (sequence: SequenceWithAnnotation): {
  readonly hasAnnotation: boolean;
  readonly isComplete: boolean;
  readonly lastUpdated: string | null;
} => {
  const annotation = sequence.sequence_annotation;
  
  if (!annotation) {
    return {
      hasAnnotation: false,
      isComplete: false,
      lastUpdated: null
    };
  }
  
  const isComplete = annotation.processing_stage === 'annotated' || 
                    annotation.processing_stage === 'reviewed';
  
  return {
    hasAnnotation: true,
    isComplete,
    lastUpdated: annotation.updated_at
  };
};

/**
 * Formats location information for display
 * 
 * @pure Function formats location without side effects
 * @param lat - Latitude
 * @param lon - Longitude
 * @param azimuth - Camera azimuth (optional)
 * @returns Formatted location string
 * 
 * @example
 * const location = formatLocationDisplay(43.123, -2.456, 180);
 * // Returns: "43.123, -2.456 (180°)"
 */
export const formatLocationDisplay = (lat: number, lon: number, azimuth: number | null): string => {
  const baseLocation = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  return azimuth !== null ? `${baseLocation} (${azimuth}°)` : baseLocation;
};

/**
 * Transforms sequence data to table row format
 * 
 * @pure Function transforms data without side effects
 * @param sequence - Raw sequence data
 * @param index - Row index for key generation
 * @param config - Table configuration options
 * @returns Formatted table row data
 * 
 * @example
 * const row = transformSequenceToTableRow(sequence, 0, config);
 */
export const transformSequenceToTableRow = (
  sequence: SequenceWithAnnotation,
  index: number,
  config: SequenceTableConfig = DEFAULT_SEQUENCE_TABLE_CONFIG
): SequenceTableRow => {
  const date = new Date(sequence.recorded_at);
  const formattedDate = date.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const formattedTime = date.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  
  const annotationStatus = analyzeAnnotationStatus(sequence);
  
  // Determine row styling based on processing stage and annotation status
  let rowClasses = '';
  if (config.showAnnotationStatus) {
    if (annotationStatus.isComplete) {
      rowClasses = 'bg-green-50';
    } else if (annotationStatus.hasAnnotation) {
      rowClasses = 'bg-yellow-50';
    } else {
      rowClasses = 'bg-white hover:bg-gray-50';
    }
  } else {
    rowClasses = 'bg-white hover:bg-gray-50';
  }
  
  return {
    id: sequence.id,
    sourceApi: formatSourceApiDisplay(sequence.source_api),
    cameraName: sequence.camera_name,
    organizationName: sequence.organisation_name,
    recordedAt: sequence.recorded_at,
    formattedDate,
    formattedTime,
    location: {
      lat: sequence.lat,
      lon: sequence.lon,
      azimuth: sequence.azimuth
    },
    isWildfireAlert: sequence.is_wildfire_alertapi,
    processingStage: sequence.sequence_annotation?.processing_stage || 'ready_to_annotate',
    annotationStatus,
    rowClasses
  };
};

/**
 * Transforms array of sequences to table rows
 * 
 * @pure Function transforms array without side effects
 * @param sequences - Array of sequence data
 * @param config - Table configuration options
 * @returns Array of formatted table rows
 * 
 * @example
 * const rows = transformSequencesToTableRows(sequences, config);
 */
export const transformSequencesToTableRows = (
  sequences: readonly SequenceWithAnnotation[],
  config: SequenceTableConfig = DEFAULT_SEQUENCE_TABLE_CONFIG
): readonly SequenceTableRow[] => {
  return sequences.map((sequence, index) => 
    transformSequenceToTableRow(sequence, index, config)
  );
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
 * const filtered = filterSequenceTableRows(rows, 'camera-1');
 */
export const filterSequenceTableRows = (
  rows: readonly SequenceTableRow[],
  searchTerm: string
): readonly SequenceTableRow[] => {
  if (!searchTerm.trim()) {
    return rows;
  }
  
  const term = searchTerm.toLowerCase();
  
  return rows.filter(row =>
    row.cameraName.toLowerCase().includes(term) ||
    row.organizationName.toLowerCase().includes(term) ||
    row.sourceApi.toLowerCase().includes(term) ||
    row.formattedDate.includes(term) ||
    row.id.toString().includes(term) ||
    formatProcessingStageDisplay(row.processingStage).toLowerCase().includes(term)
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
 * const sorted = sortSequenceTableRows(rows, 'recordedAt', 'desc');
 */
export const sortSequenceTableRows = (
  rows: readonly SequenceTableRow[],
  field: keyof SequenceTableRow,
  direction: 'asc' | 'desc' = 'asc'
): readonly SequenceTableRow[] => {
  const sortedRows = [...rows];
  
  sortedRows.sort((a, b) => {
    let aValue: any = a[field];
    let bValue: any = b[field];
    
    // Handle nested objects
    if (field === 'location') {
      // Sort by latitude first, then longitude
      if (a.location.lat !== b.location.lat) {
        aValue = a.location.lat;
        bValue = b.location.lat;
      } else {
        aValue = a.location.lon;
        bValue = b.location.lon;
      }
    } else if (field === 'annotationStatus') {
      // Sort by completion status, then by last updated
      if (a.annotationStatus.isComplete !== b.annotationStatus.isComplete) {
        aValue = a.annotationStatus.isComplete ? 1 : 0;
        bValue = b.annotationStatus.isComplete ? 1 : 0;
      } else {
        aValue = a.annotationStatus.lastUpdated || '';
        bValue = b.annotationStatus.lastUpdated || '';
      }
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
      const dateA = new Date(aValue).getTime();
      const dateB = new Date(bValue).getTime();
      return direction === 'asc' ? dateA - dateB : dateB - dateA;
    }
    
    // Handle booleans
    if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
      if (aValue === bValue) return 0;
      return direction === 'asc' 
        ? (aValue ? 1 : -1)
        : (aValue ? -1 : 1);
    }
    
    return 0;
  });
  
  return sortedRows;
};

/**
 * Groups sequences by processing stage
 * 
 * @pure Function groups data without side effects
 * @param rows - Array of table rows
 * @returns Grouped sequences by processing stage
 * 
 * @example
 * const grouped = groupSequencesByStage(rows);
 * // Returns: { ready_to_annotate: [...], annotated: [...], ... }
 */
export const groupSequencesByStage = (rows: readonly SequenceTableRow[]) => {
  const groups: Partial<Record<ProcessingStage, SequenceTableRow[]>> = {};
  
  rows.forEach(row => {
    const stage = row.processingStage;
    if (!groups[stage]) {
      groups[stage] = [];
    }
    groups[stage]!.push(row);
  });
  
  return groups;
};

/**
 * Calculates table statistics for display
 * 
 * @pure Function computes statistics without side effects
 * @param rows - Array of table rows
 * @returns Table statistics object
 * 
 * @example
 * const stats = calculateSequenceTableStats(rows);
 */
export const calculateSequenceTableStats = (rows: readonly SequenceTableRow[]) => {
  const total = rows.length;
  const withAnnotations = rows.filter(row => row.annotationStatus.hasAnnotation).length;
  const completed = rows.filter(row => row.annotationStatus.isComplete).length;
  const wildfireAlerts = rows.filter(row => row.isWildfireAlert === true).length;
  
  const stageGroups = groupSequencesByStage(rows);
  const stageCounts = Object.entries(stageGroups).reduce((acc, [stage, sequences]) => {
    acc[stage as ProcessingStage] = sequences?.length || 0;
    return acc;
  }, {} as Record<ProcessingStage, number>);
  
  return {
    total,
    withAnnotations,
    completed,
    wildfireAlerts,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    stageCounts
  } as const;
};

/**
 * Creates table state object from sequences and parameters
 * 
 * @pure Function creates state without side effects
 * @param sequences - Array of sequences
 * @param totalCount - Total number of sequences
 * @param config - Table configuration
 * @param currentPage - Current page number
 * @param pageSize - Number of items per page
 * @param isLoading - Loading state
 * @param error - Error message if any
 * @returns Complete table state object
 * 
 * @example
 * const state = createSequenceTableState(sequences, 100, config, 1, 20);
 */
export const createSequenceTableState = (
  sequences: readonly SequenceWithAnnotation[],
  totalCount: number,
  config: SequenceTableConfig = DEFAULT_SEQUENCE_TABLE_CONFIG,
  currentPage: number = 1,
  pageSize: number = 20,
  isLoading: boolean = false,
  error: string | null = null
): SequenceTableState => {
  const data = transformSequencesToTableRows(sequences, config);
  
  return {
    data,
    totalRows: totalCount,
    isLoading,
    error,
    selectedIds: [],
    sortField: config.defaultSortField,
    sortDirection: config.defaultSortDirection,
    searchTerm: '',
    currentPage,
    pageSize
  };
};

/**
 * Applies table state updates
 * 
 * @pure Function updates state without mutation
 * @param currentState - Current table state
 * @param updates - Partial state updates
 * @returns Updated table state
 * 
 * @example
 * const newState = updateSequenceTableState(state, { searchTerm: 'new-search' });
 */
export const updateSequenceTableState = (
  currentState: SequenceTableState,
  updates: Partial<SequenceTableState>
): SequenceTableState => {
  return {
    ...currentState,
    ...updates
  };
};

/**
 * Generates table row key for React rendering
 * 
 * @pure Function generates consistent keys without side effects
 * @param row - Table row data
 * @returns Unique key for React rendering
 * 
 * @example
 * const key = generateSequenceTableRowKey(row);
 * // Returns: "sequence-row-123"
 */
export const generateSequenceTableRowKey = (row: SequenceTableRow): string => {
  return `sequence-row-${row.id}`;
};

/**
 * Gets wildfire alert status display
 * 
 * @pure Function formats alert status without side effects
 * @param isWildfireAlert - Alert status
 * @returns Formatted alert status object
 * 
 * @example
 * const status = getWildfireAlertDisplay(true);
 * // Returns: { text: "Alert", classes: "text-red-600", icon: "🔥" }
 */
export const getWildfireAlertDisplay = (isWildfireAlert: boolean | null): {
  readonly text: string;
  readonly classes: string;
  readonly icon: string;
} => {
  if (isWildfireAlert === true) {
    return {
      text: 'Alert',
      classes: 'text-red-600 font-semibold',
      icon: '🔥'
    };
  } else if (isWildfireAlert === false) {
    return {
      text: 'No Alert',
      classes: 'text-green-600',
      icon: '✅'
    };
  } else {
    return {
      text: 'Unknown',
      classes: 'text-gray-500',
      icon: '❓'
    };
  }
};
export { ClassifyQueueTable } from './ClassifyQueueTable';
export { ClassifyAlertQueueTable } from './ClassifyAlertQueueTable';
export { ClassifyDoneTable } from './ClassifyDoneTable';
export { LocalizeQueueTable } from './LocalizeQueueTable';
// LocalizeDoneTable (per-sequence) is superseded by LocalizeDoneQueueTable
// (alert-grouped) on /localize/done; kept as a dead-code candidate, not
// deleted — see task-10b report.
export { LocalizeDoneTable } from './LocalizeDoneTable';
export { LocalizeDoneQueueTable } from './LocalizeDoneQueueTable';
export { PlatformAnnotationLabel } from './PlatformAnnotationLabel';
export { TablePagination } from './TablePagination';

// Detection Annotate specific components
export { DetectionAnnotateTableHeader } from './DetectionAnnotateTableHeader';

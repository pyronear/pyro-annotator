import { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SequencesPageWrapper from '@/pages/SequencesPageWrapper';
import { ALL_CLASSIFIED_STAGES } from '@/utils/processingStage';

const capturedProps: Record<string, unknown>[] = [];
vi.mock('@/pages/SequencesPage', () => ({
  default: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div data-testid="sequences-page">{props.stageSelector as ReactNode}</div>;
  },
}));

describe('SequencesPageWrapper review mode', () => {
  beforeEach(() => {
    capturedProps.length = 0;
    localStorage.clear();
  });

  it('defaults to the All classified union', () => {
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    const props = capturedProps.at(-1)!;
    expect(props.defaultProcessingStage).toEqual(ALL_CLASSIFIED_STAGES);
  });

  it('offers All classified plus the single review stages', () => {
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    const options = screen
      .getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value);
    expect(options).toEqual(['all_classified', 'seq_annotation_done', 'annotated']);
  });

  it('narrows to a single stage and persists the choice under the classify-done-stage key', () => {
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    fireEvent.change(screen.getByLabelText('Stage:'), {
      target: { value: 'seq_annotation_done' },
    });
    const props = capturedProps.at(-1)!;
    expect(props.defaultProcessingStage).toBe('seq_annotation_done');
    expect(localStorage.getItem('classify-done-stage')).toBe('seq_annotation_done');
  });

  it('passes non-review stages straight through', () => {
    render(<SequencesPageWrapper defaultProcessingStage="ready_to_annotate" />);
    const props = capturedProps.at(-1)!;
    expect(props.defaultProcessingStage).toBe('ready_to_annotate');
  });
});

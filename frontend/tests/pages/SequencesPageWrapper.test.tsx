import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/pages/SequencesPage', () => ({
  default: (props: { defaultProcessingStage?: string }) => (
    <div data-testid="stage-probe">{String(props.defaultProcessingStage)}</div>
  ),
}));

import SequencesPageWrapper from '@/pages/SequencesPageWrapper';

describe('SequencesPageWrapper', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the persisted review stage when it is still valid', () => {
    localStorage.setItem('classify-done-stage', 'annotated');
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    expect(screen.getByTestId('stage-probe')).toHaveTextContent('annotated');
  });

  it('falls back to seq_annotation_done when the persisted stage is retired', () => {
    // e.g. 'in_review' persisted before the stage was removed (#207)
    localStorage.setItem('classify-done-stage', 'in_review');
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    expect(screen.getByTestId('stage-probe')).toHaveTextContent('seq_annotation_done');
  });
});

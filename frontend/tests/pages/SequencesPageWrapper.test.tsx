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

  it('always renders the review page on the All classified union', () => {
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    expect(screen.getByTestId('stage-probe')).toHaveTextContent('seq_annotation_done,annotated');
  });

  it('ignores any stage persisted by the retired stage selector', () => {
    localStorage.setItem('classify-done-stage', 'annotated');
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    expect(screen.getByTestId('stage-probe')).toHaveTextContent('seq_annotation_done,annotated');
  });
});

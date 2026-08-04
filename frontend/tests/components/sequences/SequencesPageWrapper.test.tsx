import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SequencesPageWrapper from '@/pages/SequencesPageWrapper';
import { ALL_CLASSIFIED_STAGES } from '@/utils/processingStage';

const capturedProps: Record<string, unknown>[] = [];
vi.mock('@/pages/SequencesPage', () => ({
  default: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div data-testid="sequences-page" />;
  },
}));

describe('SequencesPageWrapper review mode', () => {
  beforeEach(() => {
    capturedProps.length = 0;
    localStorage.clear();
  });

  it('renders the review page on the All classified union', () => {
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    const props = capturedProps.at(-1)!;
    expect(props.defaultProcessingStage).toEqual(ALL_CLASSIFIED_STAGES);
    expect(props.isReviewPage).toBe(true);
  });

  it('renders without a stage selector', () => {
    render(<SequencesPageWrapper defaultProcessingStage="annotated" />);
    expect(screen.queryByLabelText('Stage:')).not.toBeInTheDocument();
    expect(capturedProps.at(-1)!.stageSelector).toBeUndefined();
  });

  it('passes non-review stages straight through', () => {
    render(<SequencesPageWrapper defaultProcessingStage="ready_to_annotate" />);
    const props = capturedProps.at(-1)!;
    expect(props.defaultProcessingStage).toBe('ready_to_annotate');
  });
});

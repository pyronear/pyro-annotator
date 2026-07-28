import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineStrip from '@/components/dashboard/PipelineStrip';

describe('PipelineStrip', () => {
  it('renders the three pipeline segments with counts', () => {
    render(
      <PipelineStrip
        classifyTodo={57}
        localizeTodo={31}
        complete={418}
        completePct={80}
        isLoading={false}
      />
    );
    expect(screen.getByText('Classify')).toBeInTheDocument();
    expect(screen.getByText('57')).toBeInTheDocument();
    expect(screen.getByText('Localize')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('418')).toBeInTheDocument();
    expect(screen.getByText('80% of all sequences')).toBeInTheDocument();
  });
});

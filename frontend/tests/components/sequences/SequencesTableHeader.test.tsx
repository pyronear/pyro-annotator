/**
 * Core functionality tests for SequencesTableHeader component.
 * Focuses on results display, pagination controls, and filtering indicators.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SequencesTableHeader } from '@/components/sequences/SequencesTableHeader';
import type { PaginatedResponse, SequenceWithAnnotation, ExtendedSequenceFilters } from '@/types/api';

// Mock constants
vi.mock('@/utils/constants', () => ({
  PAGINATION_OPTIONS: [25, 50, 100, 200],
}));

describe('SequencesTableHeader', () => {
  // Factory function for creating test paginated response data
  const createPaginatedResponse = (overrides: Partial<PaginatedResponse<SequenceWithAnnotation>> = {}): PaginatedResponse<SequenceWithAnnotation> => ({
    items: [],
    total: 150,
    page: 2,
    size: 50,
    pages: 3,
    ...overrides,
  });

  // Factory function for creating test filters
  const createFilters = (overrides: Partial<ExtendedSequenceFilters> = {}): ExtendedSequenceFilters => ({
    size: 50,
    page: 1,
    ...overrides,
  });

  const defaultProps = {
    filteredSequences: createPaginatedResponse(),
    sequences: createPaginatedResponse({ total: 300 }),
    defaultProcessingStage: 'annotated' as const,
    selectedModelAccuracy: 'all',
    filters: createFilters(),
    onFilterChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Tests', () => {
    it('should render results count correctly', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      // Page 2, size 50, total 150: showing 51-100 of 150
      expect(screen.getByText('Showing 51 to 100 of 150 results')).toBeInTheDocument();
    });

    it('should render results count for first page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 1, size: 25, total: 100 }),
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.getByText('Showing 1 to 25 of 100 results')).toBeInTheDocument();
    });

    it('should render results count for last partial page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 4, size: 50, total: 175 }),
      };
      
      render(<SequencesTableHeader {...props} />);
      
      // Page 4, size 50, total 175: showing 151-175 of 175
      expect(screen.getByText('Showing 151 to 175 of 175 results')).toBeInTheDocument();
    });

    it('should show filtered count when model accuracy filter is applied', () => {
      const props = {
        ...defaultProps,
        selectedModelAccuracy: 'high_accuracy',
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.getByText(/150 results/)).toBeInTheDocument();
      expect(screen.getByText(/\(filtered from 300 total\)/)).toBeInTheDocument();
    });

    it('should not show filtered count when no model accuracy filter', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      expect(screen.getByText(/150 results/)).toBeInTheDocument();
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should not show filtered count for non-annotated processing stage', () => {
      const props = {
        ...defaultProps,
        selectedModelAccuracy: 'high_accuracy',
        defaultProcessingStage: 'pending' as const,
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should render page size selector with current value', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      const select = screen.getByDisplayValue('50');
      expect(select).toBeInTheDocument();
      expect(select.tagName).toBe('SELECT');
    });

    it('should render all pagination options', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('should show "Show:" label for pagination selector', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      expect(screen.getByText('Show:')).toBeInTheDocument();
    });
  });

  describe('Interaction Tests', () => {
    it('should call onFilterChange when page size is changed', () => {
      const onFilterChange = vi.fn();
      const props = { ...defaultProps, onFilterChange };
      
      render(<SequencesTableHeader {...props} />);
      
      const select = screen.getByDisplayValue('50');
      fireEvent.change(select, { target: { value: '100' } });
      
      expect(onFilterChange).toHaveBeenCalledWith({ size: 100 });
      expect(onFilterChange).toHaveBeenCalledTimes(1);
    });

    it('should call onFilterChange with correct numeric value', () => {
      const onFilterChange = vi.fn();
      const props = { ...defaultProps, onFilterChange };
      
      render(<SequencesTableHeader {...props} />);
      
      const select = screen.getByDisplayValue('50');
      fireEvent.change(select, { target: { value: '25' } });
      
      expect(onFilterChange).toHaveBeenCalledWith({ size: 25 });
    });

    it('should handle string to number conversion correctly', () => {
      const onFilterChange = vi.fn();
      const props = { ...defaultProps, onFilterChange };
      
      render(<SequencesTableHeader {...props} />);
      
      const select = screen.getByDisplayValue('50');
      fireEvent.change(select, { target: { value: '200' } });
      
      expect(onFilterChange).toHaveBeenCalledWith({ size: 200 });
      expect(typeof onFilterChange.mock.calls[0][0].size).toBe('number');
    });
  });

  describe('Props Tests', () => {
    it('should handle undefined sequences prop', () => {
      const props = {
        ...defaultProps,
        sequences: undefined,
        selectedModelAccuracy: 'high_accuracy',
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.getByText(/150 results/)).toBeInTheDocument();
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should handle undefined filter size', () => {
      const props = {
        ...defaultProps,
        filters: { ...defaultProps.filters, size: undefined },
      };
      
      render(<SequencesTableHeader {...props} />);
      
      // Should default to 50
      const select = screen.getByDisplayValue('50');
      expect(select).toBeInTheDocument();
    });

    it('should handle different processing stages', () => {
      const props = {
        ...defaultProps,
        defaultProcessingStage: 'pending' as const,
        selectedModelAccuracy: 'high_accuracy',
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should handle different model accuracy values', () => {
      const modelAccuracyValues = ['all', 'high_accuracy', 'medium_accuracy', 'low_accuracy', 'unknown'];
      
      modelAccuracyValues.forEach(accuracy => {
        const props = {
          ...defaultProps,
          selectedModelAccuracy: accuracy,
          defaultProcessingStage: 'annotated' as const,
        };
        
        const { unmount } = render(<SequencesTableHeader {...props} />);
        
        if (accuracy === 'all') {
          expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
        } else {
          expect(screen.getByText(/\(filtered from 300 total\)/)).toBeInTheDocument();
        }
        
        unmount();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero results', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ 
          total: 0, 
          page: 1, 
          size: 50,
          pages: 0 
        }),
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.getByText('Showing 1 to 0 of 0 results')).toBeInTheDocument();
    });

    it('should handle single result', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ 
          total: 1, 
          page: 1, 
          size: 50 
        }),
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.getByText('Showing 1 to 1 of 1 results')).toBeInTheDocument();
    });

    it('should handle large numbers', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ 
          total: 9999, 
          page: 100, 
          size: 100 
        }),
        sequences: createPaginatedResponse({ total: 15000 }),
        selectedModelAccuracy: 'high_accuracy',
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequencesTableHeader {...props} />);
      
      expect(screen.getByText('Showing 9901 to 9999 of 9999 results')).toBeInTheDocument();
      expect(screen.getByText(/\(filtered from 15000 total\)/)).toBeInTheDocument();
    });

    it('should handle page calculation edge cases', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ 
          total: 99, 
          page: 2, 
          size: 50 
        }),
      };
      
      render(<SequencesTableHeader {...props} />);
      
      // Page 2, size 50, total 99: showing 51-99 of 99
      expect(screen.getByText('Showing 51 to 99 of 99 results')).toBeInTheDocument();
    });

    it('should handle missing filter object properties', () => {
      const props = {
        ...defaultProps,
        filters: {} as ExtendedSequenceFilters,
      };
      
      expect(() => render(<SequencesTableHeader {...props} />)).not.toThrow();
      
      // Should default to 50 when size is missing
      const select = screen.getByDisplayValue('50');
      expect(select).toBeInTheDocument();
    });
  });


  describe('Styling Tests', () => {
    it('should apply correct CSS classes to container', () => {
      const { container } = render(<SequencesTableHeader {...defaultProps} />);
      
      const headerDiv = container.firstChild as HTMLElement;
      expect(headerDiv).toHaveClass('px-4', 'py-3', 'border-b', 'border-gray-200');
    });

    it('should apply correct classes to inner container', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      const innerContainer = document.querySelector('.flex.items-center.justify-between');
      expect(innerContainer).toBeInTheDocument();
      expect(innerContainer).toHaveClass('flex', 'items-center', 'justify-between');
    });

    it('should apply correct classes to select element', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      const select = screen.getByRole('combobox');
      expect(select).toHaveClass('border', 'border-gray-300', 'rounded', 'px-2', 'py-1', 'text-sm');
    });

    it('should apply correct text styling classes', () => {
      render(<SequencesTableHeader {...defaultProps} />);
      
      const resultsText = screen.getByText(/Showing \d+ to \d+ of \d+ results/);
      expect(resultsText).toHaveClass('text-sm', 'text-gray-700');
      
      const label = screen.getByText('Show:');
      expect(label).toHaveClass('text-sm', 'text-gray-700');
      
      const filteredText = screen.queryByText(/\(filtered from/);
      if (filteredText) {
        expect(filteredText).toHaveClass('text-gray-500');
      }
    });
  });
});
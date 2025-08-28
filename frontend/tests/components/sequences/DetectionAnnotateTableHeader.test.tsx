/**
 * Core functionality tests for DetectionAnnotateTableHeader component.
 * Focuses on results display for detection annotation page, pagination controls, and filtering indicators.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetectionAnnotateTableHeader } from '@/components/sequences/DetectionAnnotateTableHeader';
import type { PaginatedResponse, SequenceWithDetectionProgress, ExtendedSequenceFilters } from '@/types/api';

// Mock constants
vi.mock('@/utils/constants', () => ({
  PAGINATION_OPTIONS: [25, 50, 100, 200],
}));

describe('DetectionAnnotateTableHeader', () => {
  // Factory function for creating test paginated response data
  const createPaginatedResponse = (overrides: Partial<PaginatedResponse<SequenceWithDetectionProgress>> = {}): PaginatedResponse<SequenceWithDetectionProgress> => ({
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
    selectedModelAccuracy: 'all',
    filters: createFilters(),
    onFilterChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Tests', () => {
    it('should render results count correctly with "sequences requiring detection annotation" text', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      // Page 2, size 50, total 150: showing 51-100 of 150
      expect(screen.getByText('Showing 51 to 100 of 150 sequences requiring detection annotation')).toBeInTheDocument();
    });

    it('should render results count for first page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 1, size: 25, total: 100 }),
      };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.getByText('Showing 1 to 25 of 100 sequences requiring detection annotation')).toBeInTheDocument();
    });

    it('should render results count for last partial page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 4, size: 50, total: 175 }),
      };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      // Page 4, size 50, total 175: showing 151-175 of 175
      expect(screen.getByText('Showing 151 to 175 of 175 sequences requiring detection annotation')).toBeInTheDocument();
    });

    it('should show filtered count when model accuracy filter is applied', () => {
      const props = {
        ...defaultProps,
        selectedModelAccuracy: 'high_accuracy',
      };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.getByText(/150 sequences requiring detection annotation/)).toBeInTheDocument();
      expect(screen.getByText(/\(filtered from 300 total\)/)).toBeInTheDocument();
    });

    it('should not show filtered count when no model accuracy filter', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      expect(screen.getByText(/150 sequences requiring detection annotation/)).toBeInTheDocument();
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should not show filtered count when sequences prop is undefined', () => {
      const props = {
        ...defaultProps,
        sequences: undefined,
        selectedModelAccuracy: 'high_accuracy',
      };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should render page size selector with current value', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      const select = screen.getByDisplayValue('50');
      expect(select).toBeInTheDocument();
      expect(select.tagName).toBe('SELECT');
    });

    it('should render all pagination options', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('should show "Show:" label for pagination selector', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      expect(screen.getByText('Show:')).toBeInTheDocument();
    });
  });

  describe('Interaction Tests', () => {
    it('should call onFilterChange when page size is changed', () => {
      const onFilterChange = vi.fn();
      const props = { ...defaultProps, onFilterChange };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      const select = screen.getByDisplayValue('50');
      fireEvent.change(select, { target: { value: '100' } });
      
      expect(onFilterChange).toHaveBeenCalledWith({ size: 100 });
      expect(onFilterChange).toHaveBeenCalledTimes(1);
    });

    it('should call onFilterChange with correct numeric value', () => {
      const onFilterChange = vi.fn();
      const props = { ...defaultProps, onFilterChange };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      const select = screen.getByDisplayValue('50');
      fireEvent.change(select, { target: { value: '25' } });
      
      expect(onFilterChange).toHaveBeenCalledWith({ size: 25 });
    });

    it('should handle string to number conversion correctly', () => {
      const onFilterChange = vi.fn();
      const props = { ...defaultProps, onFilterChange };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
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
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.getByText(/150 sequences requiring detection annotation/)).toBeInTheDocument();
      expect(screen.queryByText(/\(filtered from/)).not.toBeInTheDocument();
    });

    it('should handle undefined filter size', () => {
      const props = {
        ...defaultProps,
        filters: { ...defaultProps.filters, size: undefined },
      };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      // Should default to 50
      const select = screen.getByDisplayValue('50');
      expect(select).toBeInTheDocument();
    });

    it('should handle different model accuracy values', () => {
      const modelAccuracyValues = ['all', 'high_accuracy', 'medium_accuracy', 'low_accuracy', 'unknown'];
      
      modelAccuracyValues.forEach(accuracy => {
        const props = {
          ...defaultProps,
          selectedModelAccuracy: accuracy,
        };
        
        const { unmount } = render(<DetectionAnnotateTableHeader {...props} />);
        
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
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.getByText('Showing 1 to 0 of 0 sequences requiring detection annotation')).toBeInTheDocument();
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
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.getByText('Showing 1 to 1 of 1 sequences requiring detection annotation')).toBeInTheDocument();
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
      };
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      expect(screen.getByText('Showing 9901 to 9999 of 9999 sequences requiring detection annotation')).toBeInTheDocument();
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
      
      render(<DetectionAnnotateTableHeader {...props} />);
      
      // Page 2, size 50, total 99: showing 51-99 of 99
      expect(screen.getByText('Showing 51 to 99 of 99 sequences requiring detection annotation')).toBeInTheDocument();
    });

    it('should handle missing filter object properties', () => {
      const props = {
        ...defaultProps,
        filters: {} as ExtendedSequenceFilters,
      };
      
      expect(() => render(<DetectionAnnotateTableHeader {...props} />)).not.toThrow();
      
      // Should default to 50 when size is missing
      const select = screen.getByDisplayValue('50');
      expect(select).toBeInTheDocument();
    });
  });

  describe('Styling Tests', () => {
    it('should apply correct CSS classes to container', () => {
      const { container } = render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      const headerDiv = container.firstChild as HTMLElement;
      expect(headerDiv).toHaveClass('px-4', 'py-3', 'border-b', 'border-gray-200');
    });

    it('should apply correct classes to inner container', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      const innerContainer = document.querySelector('.flex.items-center.justify-between');
      expect(innerContainer).toBeInTheDocument();
      expect(innerContainer).toHaveClass('flex', 'items-center', 'justify-between');
    });

    it('should apply correct classes to select element', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      const select = screen.getByDisplayValue('50');
      expect(select).toHaveClass('border', 'border-gray-300', 'rounded', 'px-2', 'py-1', 'text-sm');
    });

    it('should apply correct text styling classes', () => {
      render(<DetectionAnnotateTableHeader {...defaultProps} />);
      
      const resultsText = screen.getByText(/Showing \d+ to \d+ of \d+ sequences requiring detection annotation/);
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
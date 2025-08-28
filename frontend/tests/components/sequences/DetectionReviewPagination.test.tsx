/**
 * Core functionality tests for DetectionReviewPagination component.
 * Focuses on pagination navigation, button states, and edge cases for detection review.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetectionReviewPagination } from '@/components/sequences/DetectionReviewPagination';
import type { PaginatedResponse, SequenceWithDetectionProgress } from '@/types/api';

describe('DetectionReviewPagination', () => {
  // Factory function for creating test paginated response data
  const createPaginatedResponse = (overrides: Partial<PaginatedResponse<SequenceWithDetectionProgress>> = {}): PaginatedResponse<SequenceWithDetectionProgress> => ({
    items: [],
    total: 100,
    page: 1,
    size: 25,
    pages: 4,
    ...overrides,
  });

  const defaultProps = {
    filteredSequences: createPaginatedResponse(),
    onPageChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Tests', () => {
    it('should render pagination when there are multiple pages', () => {
      render(<DetectionReviewPagination {...defaultProps} />);
      
      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
      expect(screen.getByText('Page 1 of 4')).toBeInTheDocument();
    });

    it('should render correct page information', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 3, pages: 5 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      expect(screen.getByText('Page 3 of 5')).toBeInTheDocument();
    });

    it('should not render when there is only one page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ pages: 1 }),
      };
      
      const { container } = render(<DetectionReviewPagination {...props} />);
      
      expect(container.firstChild).toBeNull();
    });

    it('should not render when there are zero pages', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ pages: 0 }),
      };
      
      const { container } = render(<DetectionReviewPagination {...props} />);
      
      expect(container.firstChild).toBeNull();
    });

    it('should render both navigation buttons', () => {
      render(<DetectionReviewPagination {...defaultProps} />);
      
      const prevButton = screen.getByText('Previous');
      const nextButton = screen.getByText('Next');
      
      expect(prevButton).toBeInTheDocument();
      expect(nextButton).toBeInTheDocument();
      expect(prevButton.tagName).toBe('BUTTON');
      expect(nextButton.tagName).toBe('BUTTON');
    });
  });

  describe('Button State Tests', () => {
    it('should disable Previous button on first page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 1, pages: 4 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const prevButton = screen.getByText('Previous');
      expect(prevButton).toBeDisabled();
    });

    it('should enable Previous button on pages other than first', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 2, pages: 4 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const prevButton = screen.getByText('Previous');
      expect(prevButton).not.toBeDisabled();
    });

    it('should disable Next button on last page', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 4, pages: 4 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      expect(nextButton).toBeDisabled();
    });

    it('should enable Next button on pages other than last', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 3, pages: 4 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      expect(nextButton).not.toBeDisabled();
    });

    it('should handle middle page correctly', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 2, pages: 4 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const prevButton = screen.getByText('Previous');
      const nextButton = screen.getByText('Next');
      
      expect(prevButton).not.toBeDisabled();
      expect(nextButton).not.toBeDisabled();
    });
  });

  describe('Interaction Tests', () => {
    it('should call onPageChange with correct page when Previous is clicked', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 3, pages: 4 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const prevButton = screen.getByText('Previous');
      fireEvent.click(prevButton);
      
      expect(onPageChange).toHaveBeenCalledWith(2);
      expect(onPageChange).toHaveBeenCalledTimes(1);
    });

    it('should call onPageChange with correct page when Next is clicked', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 2, pages: 4 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      fireEvent.click(nextButton);
      
      expect(onPageChange).toHaveBeenCalledWith(3);
      expect(onPageChange).toHaveBeenCalledTimes(1);
    });

    it('should not call onPageChange when Previous is disabled and clicked', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 1, pages: 4 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const prevButton = screen.getByText('Previous');
      fireEvent.click(prevButton);
      
      expect(onPageChange).not.toHaveBeenCalled();
    });

    it('should not call onPageChange when Next is disabled and clicked', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 4, pages: 4 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      fireEvent.click(nextButton);
      
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single page scenario (no rendering)', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 1, pages: 1 }),
      };
      
      const { container } = render(<DetectionReviewPagination {...props} />);
      
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText('Previous')).not.toBeInTheDocument();
      expect(screen.queryByText('Next')).not.toBeInTheDocument();
    });

    it('should handle zero pages scenario (no rendering)', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 0, pages: 0, total: 0 }),
      };
      
      const { container } = render(<DetectionReviewPagination {...props} />);
      
      expect(container.firstChild).toBeNull();
    });

    it('should handle large page numbers', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 999, pages: 1000 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      expect(screen.getByText('Page 999 of 1000')).toBeInTheDocument();
      
      const prevButton = screen.getByText('Previous');
      const nextButton = screen.getByText('Next');
      
      expect(prevButton).not.toBeDisabled();
      expect(nextButton).not.toBeDisabled();
    });

    it('should handle page equal to total pages', () => {
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 10, pages: 10 }),
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      expect(nextButton).toBeDisabled();
    });

    it('should handle navigation from first page', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 1, pages: 5 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      fireEvent.click(nextButton);
      
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('should handle navigation from last page', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 5, pages: 5 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const prevButton = screen.getByText('Previous');
      fireEvent.click(prevButton);
      
      expect(onPageChange).toHaveBeenCalledWith(4);
    });
  });

  describe('Styling Tests', () => {
    it('should apply correct container classes', () => {
      const { container } = render(<DetectionReviewPagination {...defaultProps} />);
      
      const paginationDiv = container.firstChild as HTMLElement;
      expect(paginationDiv).toHaveClass(
        'px-4',
        'py-3',
        'border-t',
        'border-gray-200',
        'flex',
        'items-center',
        'justify-between'
      );
    });

    it('should apply correct button classes', () => {
      render(<DetectionReviewPagination {...defaultProps} />);
      
      const prevButton = screen.getByText('Previous');
      const nextButton = screen.getByText('Next');
      
      const expectedClasses = [
        'px-3',
        'py-1',
        'border',
        'border-gray-300',
        'rounded',
        'text-sm',
        'disabled:opacity-50',
        'disabled:cursor-not-allowed',
        'hover:bg-gray-50',
      ];
      
      expectedClasses.forEach(className => {
        expect(prevButton).toHaveClass(className);
        expect(nextButton).toHaveClass(className);
      });
    });

    it('should apply correct text styling', () => {
      render(<DetectionReviewPagination {...defaultProps} />);
      
      const pageText = screen.getByText('Page 1 of 4');
      expect(pageText).toHaveClass('text-sm', 'text-gray-700');
      expect(pageText.tagName).toBe('SPAN');
    });

    it('should apply correct spacing classes', () => {
      const { container } = render(<DetectionReviewPagination {...defaultProps} />);
      
      const buttonContainer = container.querySelector('.flex.items-center.space-x-2');
      expect(buttonContainer).toBeInTheDocument();
      expect(buttonContainer).toHaveClass('space-x-2');
    });
  });

  describe('Component Integration', () => {
    it('should work with different pagination configurations', () => {
      const configurations = [
        { page: 1, pages: 2 },
        { page: 2, pages: 2 },
        { page: 5, pages: 10 },
        { page: 10, pages: 10 },
        { page: 50, pages: 100 },
      ];
      
      configurations.forEach(({ page, pages }) => {
        const props = {
          ...defaultProps,
          filteredSequences: createPaginatedResponse({ page, pages }),
        };
        
        const { unmount } = render(<DetectionReviewPagination {...props} />);
        
        expect(screen.getByText(`Page ${page} of ${pages}`)).toBeInTheDocument();
        
        const prevButton = screen.getByText('Previous');
        const nextButton = screen.getByText('Next');
        
        if (page === 1) {
          expect(prevButton).toBeDisabled();
        } else {
          expect(prevButton).not.toBeDisabled();
        }
        
        if (page === pages) {
          expect(nextButton).toBeDisabled();
        } else {
          expect(nextButton).not.toBeDisabled();
        }
        
        unmount();
      });
    });

    it('should handle rapid button clicks gracefully', () => {
      const onPageChange = vi.fn();
      const props = {
        ...defaultProps,
        filteredSequences: createPaginatedResponse({ page: 5, pages: 10 }),
        onPageChange,
      };
      
      render(<DetectionReviewPagination {...props} />);
      
      const nextButton = screen.getByText('Next');
      
      // Simulate rapid clicks
      fireEvent.click(nextButton);
      fireEvent.click(nextButton);
      fireEvent.click(nextButton);
      
      expect(onPageChange).toHaveBeenCalledTimes(3);
      expect(onPageChange).toHaveBeenCalledWith(6);
    });
  });
});
/**
 * Core functionality tests for SequencesLegend component.
 * Focuses on display of color-coded legend indicators and accessibility.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { SequencesLegend } from '@/components/sequences/SequencesLegend';

describe('SequencesLegend', () => {
  describe('Display Tests', () => {
    it('should render legend title', () => {
      render(<SequencesLegend />);
      
      expect(screen.getByText('Row Colors:')).toBeInTheDocument();
    });

    it('should render all row color indicators', () => {
      render(<SequencesLegend />);
      
      expect(screen.getByText('True Positive (Model correct)')).toBeInTheDocument();
      expect(screen.getByText('False Positive (Model incorrect)')).toBeInTheDocument();
      expect(screen.getByText('False Negative (Model missed smoke)')).toBeInTheDocument();
      expect(screen.getByText('Unsure (Needs review)')).toBeInTheDocument();
    });

    it('should render pill type indicators', () => {
      render(<SequencesLegend />);
      
      expect(screen.getByText('Smoke Types')).toBeInTheDocument();
      expect(screen.getByText('False Positive Types')).toBeInTheDocument();
    });

    it('should render all legend items', () => {
      render(<SequencesLegend />);
      
      // Count all color indicator boxes (should be 6 total)
      const { container } = render(<SequencesLegend />);
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      expect(colorBoxes).toHaveLength(6);
    });
  });

  describe('Styling Tests', () => {
    it('should apply correct container classes', () => {
      const { container } = render(<SequencesLegend />);
      
      const legendContainer = container.firstChild as HTMLElement;
      expect(legendContainer).toHaveClass('px-4', 'py-2', 'bg-gray-50', 'border-b', 'border-gray-200');
    });

    it('should apply correct inner container classes', () => {
      render(<SequencesLegend />);
      
      const innerContainer = document.querySelector('.flex.items-center.justify-between.text-xs');
      expect(innerContainer).toBeInTheDocument();
      expect(innerContainer).toHaveClass('flex', 'items-center', 'justify-between', 'text-xs');
    });

    it('should apply correct color classes to True Positive indicator', () => {
      const { container } = render(<SequencesLegend />);
      
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      const truePositiveBox = colorBoxes[0];
      expect(truePositiveBox).toHaveClass('bg-green-200', 'border', 'border-green-300', 'rounded');
    });

    it('should apply correct color classes to False Positive indicator', () => {
      const { container } = render(<SequencesLegend />);
      
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      const falsePositiveBox = colorBoxes[1];
      expect(falsePositiveBox).toHaveClass('bg-red-200', 'border', 'border-red-300', 'rounded');
    });

    it('should apply correct color classes to False Negative indicator', () => {
      const { container } = render(<SequencesLegend />);
      
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      const falseNegativeBox = colorBoxes[2];
      expect(falseNegativeBox).toHaveClass('bg-blue-200', 'border', 'border-blue-300', 'rounded');
    });

    it('should apply correct color classes to Unsure indicator', () => {
      const { container } = render(<SequencesLegend />);
      
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      const unsureBox = colorBoxes[3];
      expect(unsureBox).toHaveClass('bg-amber-50', 'border', 'border-amber-300', 'rounded');
    });

    it('should apply correct color classes to Smoke Types indicator', () => {
      const { container } = render(<SequencesLegend />);
      
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      const smokeTypesBox = colorBoxes[4];
      expect(smokeTypesBox).toHaveClass('bg-orange-200', 'border', 'border-orange-300', 'rounded');
    });

    it('should apply correct color classes to False Positive Types indicator', () => {
      const { container } = render(<SequencesLegend />);
      
      const colorBoxes = container.querySelectorAll('.w-3.h-3');
      const falsePositiveTypesBox = colorBoxes[5];
      expect(falsePositiveTypesBox).toHaveClass('bg-yellow-200', 'border', 'border-yellow-300', 'rounded');
    });

    it('should apply correct text styling classes', () => {
      render(<SequencesLegend />);
      
      const title = screen.getByText('Row Colors:');
      expect(title).toHaveClass('font-medium', 'text-gray-700');
      
      const labels = [
        screen.getByText('True Positive (Model correct)'),
        screen.getByText('False Positive (Model incorrect)'),
        screen.getByText('False Negative (Model missed smoke)'),
        screen.getByText('Unsure (Needs review)'),
        screen.getByText('Smoke Types'),
        screen.getByText('False Positive Types'),
      ];
      
      labels.forEach(label => {
        expect(label).toHaveClass('text-gray-600');
      });
    });

    it('should apply correct spacing classes', () => {
      const { container } = render(<SequencesLegend />);
      
      // Check for space-x-6 on main legend items
      const mainLegendContainer = container.querySelector('.flex.items-center.space-x-6');
      expect(mainLegendContainer).toBeInTheDocument();
      expect(mainLegendContainer).toHaveClass('space-x-6');
      
      // Check for space-x-2 on pill type indicators
      const pillTypeContainer = container.querySelectorAll('.flex.items-center.space-x-2')[0];
      expect(pillTypeContainer).toBeInTheDocument();
      expect(pillTypeContainer).toHaveClass('space-x-2');
      
      // Check for space-x-1 on individual legend items
      const individualItems = container.querySelectorAll('.flex.items-center.space-x-1');
      expect(individualItems.length).toBeGreaterThan(0);
      individualItems.forEach(item => {
        expect(item).toHaveClass('space-x-1');
      });
    });
  });

  describe('Structure Tests', () => {
    it('should have proper DOM structure', () => {
      const { container } = render(<SequencesLegend />);
      
      // Should have main container div
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.tagName).toBe('DIV');
      
      // Should have inner flex container
      const innerDiv = mainDiv.firstChild as HTMLElement;
      expect(innerDiv.tagName).toBe('DIV');
      expect(innerDiv).toHaveClass('flex');
    });

    it('should organize legend items in proper groups', () => {
      render(<SequencesLegend />);
      
      // Row Colors title should be present
      expect(screen.getByText('Row Colors:')).toBeInTheDocument();
      
      // Model accuracy indicators should be grouped together
      const modelAccuracyLabels = [
        'True Positive (Model correct)',
        'False Positive (Model incorrect)',
        'False Negative (Model missed smoke)',
        'Unsure (Needs review)',
      ];
      
      modelAccuracyLabels.forEach(label => {
        expect(screen.getByText(label)).toBeInTheDocument();
      });
      
      // Pill type indicators should be grouped together
      const pillTypeLabels = ['Smoke Types', 'False Positive Types'];
      pillTypeLabels.forEach(label => {
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    });

    it('should have color boxes paired with labels', () => {
      const { container } = render(<SequencesLegend />);
      
      // Each legend item should be in a flex container with space-x-1
      const legendItems = container.querySelectorAll('.flex.items-center.space-x-1');
      expect(legendItems.length).toBe(6); // 4 model accuracy + 2 pill types
      
      // Each should contain a color box and text
      legendItems.forEach(item => {
        const colorBox = item.querySelector('.w-3.h-3');
        const text = item.querySelector('span');
        
        expect(colorBox).toBeInTheDocument();
        expect(text).toBeInTheDocument();
        expect(text?.textContent).toBeTruthy();
      });
    });
  });


  describe('Component Stability', () => {
    it('should render consistently on multiple renders', () => {
      const { rerender } = render(<SequencesLegend />);
      
      expect(screen.getByText('Row Colors:')).toBeInTheDocument();
      expect(screen.getAllByText(/True Positive|False Positive|False Negative|Unsure|Smoke Types/)).toHaveLength(6);
      
      rerender(<SequencesLegend />);
      
      expect(screen.getByText('Row Colors:')).toBeInTheDocument();
      expect(screen.getAllByText(/True Positive|False Positive|False Negative|Unsure|Smoke Types/)).toHaveLength(6);
    });

    it('should be a pure component with no props', () => {
      const { container: container1 } = render(<SequencesLegend />);
      const { container: container2 } = render(<SequencesLegend />);
      
      expect(container1.innerHTML).toBe(container2.innerHTML);
    });

    it('should not throw errors', () => {
      expect(() => render(<SequencesLegend />)).not.toThrow();
    });

    it('should maintain DOM structure integrity', () => {
      const { container } = render(<SequencesLegend />);
      
      // Should have exactly one root element
      expect(container.children).toHaveLength(1);
      
      // Root should be a div with expected classes
      const root = container.firstChild as HTMLElement;
      expect(root.tagName).toBe('DIV');
      expect(root).toHaveClass('px-4');
    });
  });
});
/**
 * Submission controls for detection annotation.
 * Handles annotation submission with validation and feedback.
 */

// Simple submission button component

interface SubmissionControlsProps {
  isSubmitting: boolean;
  isAnnotated: boolean;
  onSubmit: () => void;
}

export function SubmissionControls({
  isSubmitting,
  isAnnotated,
  onSubmit
}: SubmissionControlsProps) {

  return (
    <div className="flex justify-center mt-4">
      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {isSubmitting ? (
          <>
            <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            {isAnnotated ? 'Updating...' : 'Submitting...'}
          </>
        ) : (
          <>
            {isAnnotated ? 'Update' : 'Submit'}
            <span className="ml-2 text-xs text-primary-200">(Space)</span>
          </>
        )}
      </button>
    </div>
  );
}
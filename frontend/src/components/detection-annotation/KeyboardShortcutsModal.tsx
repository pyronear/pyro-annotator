/**
 * Keyboard shortcuts help modal for detection annotation.
 * Shows available keyboard shortcuts with contextual availability.
 */

import {
  X,
  Keyboard,
  Navigation,
  MousePointer,
  Square,
  Trash2,
  Undo,
  Upload,
  CheckCircle,
  Eye,
} from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isVisible: boolean;
  onClose: () => void;
  isDrawMode: boolean;
  hasRectangles: boolean;
  hasUndoHistory: boolean;
  isAnnotated: boolean;
}

const KeyShortcut = ({
  keys,
  description,
  icon,
  disabled = false,
}: {
  keys: string[];
  description: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}) => (
  <div
    className={`flex items-center space-x-3 py-2 px-3 rounded-md ${disabled ? 'opacity-50' : 'hover:bg-white/5'}`}
  >
    <div className="flex items-center space-x-1 min-w-20">
      {keys.map((key, index) => (
        <span key={index}>
          <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md">
            {key}
          </kbd>
          {index < keys.length - 1 && <span className="text-gray-400 mx-1">+</span>}
        </span>
      ))}
    </div>
    <div className="flex items-center space-x-2 flex-1">
      {icon && <div className="text-gray-400 w-4 h-4">{icon}</div>}
      <span className="text-sm text-white">{description}</span>
    </div>
  </div>
);

export function KeyboardShortcutsModal({
  isVisible,
  onClose,
  isDrawMode,
  hasRectangles,
  hasUndoHistory,
  isAnnotated,
}: KeyboardShortcutsModalProps) {
  if (!isVisible) return null;

  // Handle escape key for this modal specifically
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Handle overlay click with proper event stopping
  const handleOverlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  // Prevent modal content clicks from propagating
  const handleContentClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4 max-h-96 overflow-y-auto"
        onClick={handleContentClick}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Keyboard className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Keyboard Shortcuts</h3>
          </div>
          <button
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Navigation */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2 flex items-center space-x-2">
              <Navigation className="w-4 h-4" />
              <span>Navigation</span>
            </h4>
            <div className="space-y-1">
              <KeyShortcut keys={['←']} description="Previous detection" />
              <KeyShortcut keys={['→']} description="Next detection" />
              <KeyShortcut keys={['Esc']} description="Close modal" />
            </div>
          </div>

          {/* Drawing Mode */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2 flex items-center space-x-2">
              <MousePointer className="w-4 h-4" />
              <span>Drawing Mode</span>
            </h4>
            <div className="space-y-1">
              <KeyShortcut
                keys={['D']}
                description={isDrawMode ? 'Switch to selection mode' : 'Switch to drawing mode'}
                icon={
                  isDrawMode ? <MousePointer className="w-4 h-4" /> : <Square className="w-4 h-4" />
                }
              />
              <KeyShortcut
                keys={['V']}
                description="Toggle AI predictions"
                icon={<Eye className="w-4 h-4" />}
              />
              <KeyShortcut
                keys={['Delete', 'X']}
                description={
                  hasRectangles ? 'Delete selected/all rectangles' : 'No rectangles to delete'
                }
                icon={<Trash2 className="w-4 h-4" />}
                disabled={!hasRectangles}
              />
              <KeyShortcut
                keys={['Ctrl', 'Z']}
                description="Undo last action"
                icon={<Undo className="w-4 h-4" />}
                disabled={!hasUndoHistory}
              />
              <KeyShortcut keys={['R']} description="Reset zoom" />
              <KeyShortcut
                keys={['U']}
                description="Import AI predictions"
                icon={<Upload className="w-4 h-4" />}
              />
            </div>
          </div>

          {/* Smoke Classification */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2">Smoke Classification</h4>
            <div className="space-y-1">
              <KeyShortcut keys={['1', 'W']} description="🔥 Wildfire smoke" />
              <KeyShortcut keys={['2', 'I']} description="🏭 Industrial smoke" />
              <KeyShortcut keys={['3', 'O']} description="💨 Other smoke" />
            </div>
          </div>

          {/* Actions */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2">Actions</h4>
            <div className="space-y-1">
              <KeyShortcut
                keys={['Space']}
                description={isAnnotated ? 'Update annotation' : 'Submit annotation'}
                icon={<CheckCircle className="w-4 h-4" />}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-400 text-center">
            Press <kbd className="px-1 py-0.5 text-xs bg-gray-700 rounded">?</kbd> or{' '}
            <kbd className="px-1 py-0.5 text-xs bg-gray-700 rounded">H</kbd> to toggle shortcuts
          </p>
        </div>
      </div>
    </div>
  );
}

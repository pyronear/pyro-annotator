import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import { SMOKE_TYPES } from '@/utils/constants';
import { getSmokeTypeEmoji, formatSmokeType } from '@/utils/modelAccuracy';

interface SmokeTypeFilterProps {
  selectedTypes: string[];
  onSelectionChange: (selectedTypes: string[]) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}


export default function SmokeTypeFilter({
  selectedTypes,
  onSelectionChange,
  label = 'Smoke Types',
  placeholder = 'Filter by smoke types...',
  className = '',
}: SmokeTypeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter types based on search term
  const filteredTypes = SMOKE_TYPES.filter(type =>
    formatSmokeType(type).toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle selection toggle
  const toggleSelection = (type: string) => {
    const isSelected = selectedTypes.includes(type);
    let newSelection;
    if (isSelected) {
      newSelection = selectedTypes.filter(t => t !== type);
    } else {
      newSelection = [...selectedTypes, type];
    }
    onSelectionChange(newSelection);
  };

  // Handle select all
  const selectAll = () => {
    onSelectionChange([...SMOKE_TYPES]);
  };

  // Handle clear all
  const clearAll = () => {
    onSelectionChange([]);
  };

  // Remove individual selection
  const removeSelection = (type: string) => {
    onSelectionChange(selectedTypes.filter(t => t !== type));
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      {/* Selected Pills - Show above dropdown when selections exist */}
      {selectedTypes.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selectedTypes.map(type => (
            <span
              key={type}
              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200"
            >
              {getSmokeTypeEmoji(type)} {formatSmokeType(type)}
              <button
                type="button"
                onClick={() => removeSelection(type)}
                className="ml-1 hover:bg-orange-200 rounded-full p-0.5 transition-colors"
                title={`Remove ${formatSmokeType(type)}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown Trigger */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-left focus:ring-primary-500 focus:border-primary-500 hover:bg-gray-50 transition-colors flex items-center justify-between"
        >
          <span className={selectedTypes.length > 0 ? 'text-gray-900' : 'text-gray-500'}>
            {selectedTypes.length > 0
              ? `${selectedTypes.length} type${selectedTypes.length !== 1 ? 's' : ''} selected`
              : placeholder
            }
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
            {/* Search Box */}
            <div className="p-2 border-b border-gray-200">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search types..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 text-sm border border-gray-300 rounded focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-2 border-b border-gray-200 flex justify-between">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-primary-600 hover:text-primary-800 font-medium"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-gray-600 hover:text-gray-800 font-medium"
              >
                Clear All
              </button>
            </div>

            {/* Options List */}
            <div className="max-h-48 overflow-y-auto">
              {filteredTypes.length > 0 ? (
                filteredTypes.map(type => {
                  const isSelected = selectedTypes.includes(type);
                  return (
                    <label
                      key={type}
                      className={`flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-primary-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(type)}
                        className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded mr-3"
                      />
                      <span className="flex items-center space-x-2">
                        <span>{getSmokeTypeEmoji(type)}</span>
                        <span className={isSelected ? 'text-primary-900 font-medium' : 'text-gray-700'}>
                          {formatSmokeType(type)}
                        </span>
                      </span>
                    </label>
                  );
                })
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500 text-center">
                  No types match your search
                </div>
              )}
            </div>

            {/* Footer with count */}
            <div className="p-2 border-t border-gray-200 text-xs text-gray-500 text-center">
              {selectedTypes.length} of {SMOKE_TYPES.length} types selected
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
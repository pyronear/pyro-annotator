export function SequencesLegend() {
  return (
    <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center space-x-6">
          <span className="font-medium text-gray-700">Row Colors:</span>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-green-200 border border-green-300 rounded"></div>
            <span className="text-gray-600">True Positive (Model correct)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-red-200 border border-red-300 rounded"></div>
            <span className="text-gray-600">False Positive (Model incorrect)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-blue-200 border border-blue-300 rounded"></div>
            <span className="text-gray-600">False Negative (Model missed smoke)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-amber-50 border border-amber-300 rounded"></div>
            <span className="text-gray-600">Unsure (Needs review)</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-orange-200 border border-orange-300 rounded"></div>
            <span className="text-gray-600">Smoke Types</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-yellow-200 border border-yellow-300 rounded"></div>
            <span className="text-gray-600">False Positive Types</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import {
  Target,
  CheckCircle2,
  Clock,
  Database,
  Zap,
  ArrowRight,
  AlertTriangle,
  Activity,
  BarChart3,
  Layers,
} from 'lucide-react';
import { useAnnotationStats } from '@/hooks/useAnnotationStats';
import ProgressBar, { MultiStageProgressBar } from '@/components/ProgressBar';
import logoImg from '@/assets/logo.png';

export default function DashboardPage() {
  const {
    totalSequences,
    processingStages,
    sequencesWithCompleteDetections,
    sequencesWithIncompleteDetections,
    detectionCompletionPercentage,
    isLoading,
    error,
  } = useAnnotationStats();

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <img src={logoImg} alt="PyroAnnotator Logo" className="w-16 h-16 object-contain" />
            <div>
              <h1 className="text-3xl font-bold mb-2">Welcome to PyroAnnotator</h1>
              <p className="text-blue-100 text-lg">
                Wildfire detection annotation system - Track your progress and manage workflows
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-6">
            <div className="text-center">
              <div className="text-3xl font-bold">
                {isLoading ? '–' : totalSequences.toLocaleString()}
              </div>
              <div className="text-blue-200 text-sm">Total Sequences</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-300">
                {isLoading
                  ? '–'
                  : `${Math.round((processingStages.annotated / Math.max(totalSequences, 1)) * 100)}%`}
              </div>
              <div className="text-blue-200 text-sm">Complete</div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Sequence Annotations Complete */}
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Layers className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Sequence Annotations</h3>
                <p className="text-sm text-gray-600">Complete sequence-level work</p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-green-600">
                {isLoading ? (
                  <div className="animate-pulse bg-gray-200 h-9 w-16 rounded"></div>
                ) : (
                  processingStages.annotated.toLocaleString()
                )}
              </span>
              <span className="text-gray-500">sequences</span>
            </div>
            <div className="mt-3">
              {isLoading ? (
                <div className="animate-pulse bg-gray-200 h-2 rounded-full"></div>
              ) : (
                <ProgressBar
                  value={processingStages.annotated}
                  max={totalSequences}
                  color="green"
                  height={20}
                  ariaLabel="Sequence annotation progress"
                />
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {isLoading
                ? 'Loading...'
                : `${Math.round((processingStages.annotated / Math.max(totalSequences, 1)) * 100)}% of all sequences`}
            </p>
          </div>
        </div>

        {/* Detection Annotations Complete */}
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Target className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Detection Annotations</h3>
                <p className="text-sm text-gray-600">All detections annotated</p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-blue-600">
                {isLoading ? (
                  <div className="animate-pulse bg-gray-200 h-9 w-16 rounded"></div>
                ) : (
                  sequencesWithCompleteDetections.toLocaleString()
                )}
              </span>
              <span className="text-gray-500">sequences</span>
            </div>
            <div className="mt-3">
              {isLoading ? (
                <div className="animate-pulse bg-gray-200 h-2 rounded-full"></div>
              ) : (
                <ProgressBar
                  value={sequencesWithCompleteDetections}
                  max={sequencesWithCompleteDetections + sequencesWithIncompleteDetections}
                  color="primary"
                  height={20}
                  ariaLabel="Detection annotation progress"
                />
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {isLoading
                ? 'Loading...'
                : `${isNaN(detectionCompletionPercentage) ? 0 : detectionCompletionPercentage}% of sequences with detections`}
            </p>
          </div>
        </div>

        {/* Ready to Annotate */}
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Clock className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Ready to Annotate</h3>
                <p className="text-sm text-gray-600">Pending annotation work</p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-orange-600">
                {isLoading ? (
                  <div className="animate-pulse bg-gray-200 h-9 w-16 rounded"></div>
                ) : (
                  processingStages.ready_to_annotate.toLocaleString()
                )}
              </span>
              <span className="text-gray-500">sequences</span>
            </div>
            <div className="mt-3">
              {processingStages.ready_to_annotate > 0 ? (
                <Link
                  to="/sequences/annotate"
                  className="inline-flex items-center text-sm font-medium text-orange-600 hover:text-orange-700"
                >
                  Start annotating <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              ) : (
                <span className="text-sm text-gray-500">No pending work</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Workflow Actions */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/sequences/annotate"
          className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
              <Database className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Browse Sequences</h3>
              <p className="text-sm text-gray-600">View all sequences</p>
            </div>
          </div>
        </Link>

        <Link
          to="/detections/annotate"
          className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-purple-300 transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
              <Zap className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Detection Work</h3>
              <p className="text-sm text-gray-600">Annotate detections</p>
            </div>
          </div>
        </Link>

        <Link
          to="/sequences/review"
          className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-green-300 transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200 transition-colors">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Review Work</h3>
              <p className="text-sm text-gray-600">Check completed</p>
            </div>
          </div>
        </Link>

        <Link
          to="/detections/review"
          className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-400 transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-gray-200 transition-colors">
              <BarChart3 className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Detection Review</h3>
              <p className="text-sm text-gray-600">Review detections</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Progress Visualization */}
      <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Activity className="w-6 h-6 text-gray-600" />
            <h2 className="text-xl font-bold text-gray-900">Processing Pipeline</h2>
          </div>
          {error && (
            <div className="flex items-center text-red-600 text-sm">
              <AlertTriangle className="w-4 h-4 mr-1" />
              Failed to load statistics
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Overall Progress */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-gray-900">Overall Progress</h3>
              <span className="text-sm text-gray-500">
                {processingStages.annotated} of {totalSequences} sequences complete
              </span>
            </div>
            {isLoading ? (
              <div className="animate-pulse bg-gray-200 h-6 rounded-full"></div>
            ) : (
              <ProgressBar
                value={processingStages.annotated}
                max={totalSequences}
                color="green"
                height={24}
                showPercentage={true}
                ariaLabel="Overall annotation completion"
              />
            )}
          </div>

          {/* Stage Breakdown */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Stage Breakdown</h3>
            <p className="text-sm text-gray-600 mb-4">
              Distribution of sequences across processing stages
            </p>
            {isLoading ? (
              <div className="space-y-2">
                <div className="animate-pulse bg-gray-200 h-8 rounded-full"></div>
                <div className="animate-pulse bg-gray-200 h-4 rounded"></div>
              </div>
            ) : (
              <MultiStageProgressBar
                stages={[
                  {
                    label: 'imported',
                    value: processingStages.imported,
                    color: 'gray',
                  },
                  {
                    label: 'ready to annotate',
                    value: processingStages.ready_to_annotate,
                    color: 'orange',
                  },
                  {
                    label: 'annotated',
                    value: processingStages.annotated,
                    color: 'green',
                  },
                ]}
                total={
                  processingStages.imported +
                  processingStages.ready_to_annotate +
                  processingStages.annotated
                }
                height={32}
                showLabels={true}
              />
            )}
          </div>

          {/* Detection Progress */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium text-gray-900">Detection Annotation Progress</h3>
              <span className="text-sm text-gray-500">
                {sequencesWithCompleteDetections} of{' '}
                {sequencesWithCompleteDetections + sequencesWithIncompleteDetections} sequences
              </span>
            </div>
            {isLoading ? (
              <div className="animate-pulse bg-gray-200 h-6 rounded-full"></div>
            ) : (
              <ProgressBar
                value={sequencesWithCompleteDetections}
                max={sequencesWithCompleteDetections + sequencesWithIncompleteDetections}
                color="primary"
                height={24}
                showPercentage={true}
                ariaLabel="Detection annotation completion"
              />
            )}
          </div>
        </div>
      </div>

      {/* Quick Start */}
      {processingStages.ready_to_annotate > 0 && (
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold mb-2">Ready to Start Annotating?</h3>
              <p className="text-orange-100">
                You have {processingStages.ready_to_annotate} sequences waiting for annotation
              </p>
            </div>
            <div className="flex space-x-3">
              <Link
                to="/sequences/annotate"
                className="inline-flex items-center px-6 py-3 bg-white text-orange-600 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Start Annotating
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

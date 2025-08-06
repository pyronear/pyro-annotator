import { Link } from 'react-router-dom';
import { AlertCircle, TrendingUp, CheckCircle, Clock, Database } from 'lucide-react';
import { useAnnotationStats } from '@/hooks/useAnnotationStats';
import ProgressBar, { MultiStageProgressBar } from '@/components/ProgressBar';

export default function DashboardPage() {
  const { 
    totalSequences, 
    annotatedSequences, 
    pendingSequences, 
    completionPercentage,
    processingStages,
    isLoading, 
    error 
  } = useAnnotationStats();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">
            Overview of annotation progress and system statistics
          </p>
        </div>
        {error && (
          <div className="flex items-center text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 mr-1" />
            Failed to load statistics
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-3 gap-6">
        <Link 
          to="/sequences"
          className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
        >
          <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-primary-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Browse Sequences
          </h3>
          <p className="text-gray-600 text-sm">
            View and manage all detection sequences
          </p>
        </Link>

        <Link 
          to="/annotations"
          className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
        >
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <CheckCircle className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            View Annotations
          </h3>
          <p className="text-gray-600 text-sm">
            Review completed annotations and export data
          </p>
        </Link>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
            <TrendingUp className="w-6 h-6 text-orange-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Progress Overview
          </h3>
          <p className="text-gray-600 text-sm">
            Real-time annotation statistics and progress
          </p>
        </div>
      </div>

      {/* Progress Statistics */}
      <div className="bg-white rounded-lg p-8 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            Annotation Progress
          </h2>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="text-center">
            <div className="text-3xl font-bold text-primary-600 mb-1">
              {isLoading ? (
                <div className="animate-pulse bg-gray-200 h-9 w-16 mx-auto rounded"></div>
              ) : (
                totalSequences.toLocaleString()
              )}
            </div>
            <div className="text-sm text-gray-600">Total Sequences</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600 mb-1">
              {isLoading ? (
                <div className="animate-pulse bg-gray-200 h-9 w-16 mx-auto rounded"></div>
              ) : (
                processingStages.annotated.toLocaleString()
              )}
            </div>
            <div className="text-sm text-gray-600">Fully Annotated</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-orange-600 mb-1">
              {isLoading ? (
                <div className="animate-pulse bg-gray-200 h-9 w-16 mx-auto rounded"></div>
              ) : (
                (processingStages.imported + processingStages.ready_to_annotate).toLocaleString()
              )}
            </div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-primary-600 mb-1">
              {isLoading ? (
                <div className="animate-pulse bg-gray-200 h-9 w-16 mx-auto rounded"></div>
              ) : (
                `${Math.round((processingStages.annotated / Math.max(totalSequences, 1)) * 100)}%`
              )}
            </div>
            <div className="text-sm text-gray-600">Completion</div>
          </div>
        </div>

        {/* Overall Progress Bar - Only Annotated Sequences */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-medium text-gray-900">Annotation Completion</h3>
            <span className="text-sm text-gray-500">
              {processingStages.annotated} of {totalSequences} sequences fully annotated
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
              ariaLabel={`Annotation completion: ${Math.round((processingStages.annotated / Math.max(totalSequences, 1)) * 100)}% complete`}
            />
          )}
        </div>

        {/* Processing Stages Progress */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Processing Pipeline</h3>
          <p className="text-sm text-gray-600 mb-4">
            Breakdown of sequences by processing stage
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
                  color: 'gray'
                },
                {
                  label: 'ready to annotate', 
                  value: processingStages.ready_to_annotate,
                  color: 'orange'
                },
                {
                  label: 'annotated',
                  value: processingStages.annotated,
                  color: 'green'
                }
              ]}
              total={processingStages.imported + processingStages.ready_to_annotate + processingStages.annotated}
              height={32}
              showLabels={true}
            />
          )}
        </div>
      </div>

      {/* Quick Actions Footer */}
      <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Ready to Start?</h3>
            <p className="text-sm text-gray-600">
              Begin annotating sequences or review existing work
            </p>
          </div>
          <div className="flex space-x-3">
            <Link
              to="/sequences"
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Clock className="w-4 h-4 mr-2" />
              View Pending
            </Link>
            <Link
              to="/sequences"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700"
            >
              Start Annotating
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
import { CheckCircle, Circle, Clock } from 'lucide-react';
import { clsx } from 'clsx';

interface ProgressStep {
  id: string;
  name: string;
  description?: string;
  status: 'completed' | 'current' | 'upcoming';
}

interface ProgressIndicatorProps {
  steps: ProgressStep[];
  currentStep: number;
  className?: string;
}

export default function ProgressIndicator({ 
  steps, 
  currentStep, 
  className 
}: ProgressIndicatorProps) {
  return (
    <div className={clsx('w-full', className)}>
      {/* Progress bar */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="h-1 w-full bg-gray-200 rounded-full">
            <div
              className="h-1 bg-primary-600 rounded-full transition-all duration-300"
              style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
            />
          </div>
        </div>
        
        <div className="relative flex justify-between">
          {steps.map((step, stepIdx) => (
            <div key={step.id} className="flex flex-col items-center">
              <div
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-200',
                  stepIdx <= currentStep
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-300 bg-white text-gray-500'
                )}
              >
                {stepIdx < currentStep ? (
                  <CheckCircle className="h-5 w-5" />
                ) : stepIdx === currentStep ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
              </div>
              
              <div className="mt-2 text-center">
                <div
                  className={clsx(
                    'text-sm font-medium',
                    stepIdx <= currentStep
                      ? 'text-primary-600'
                      : 'text-gray-500'
                  )}
                >
                  {step.name}
                </div>
                {step.description && (
                  <div className="text-xs text-gray-400 mt-1 max-w-24">
                    {step.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface CircularProgressProps {
  percentage: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export function CircularProgress({ 
  percentage, 
  size = 'md', 
  showText = true,
  className 
}: CircularProgressProps) {
  const sizeClasses = {
    sm: 'h-12 w-12',
    md: 'h-16 w-16', 
    lg: 'h-24 w-24',
    xl: 'h-32 w-32',
  };
  
  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
  };

  // Calculate stroke dash values for the circle
  const radius = size === 'sm' ? 16 : size === 'md' ? 24 : size === 'lg' ? 40 : 56;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className={clsx('relative inline-flex items-center justify-center', sizeClasses[size], className)}>
      <svg
        className="transform -rotate-90"
        width="100%"
        height="100%"
        viewBox={`0 0 ${radius * 2 + 8} ${radius * 2 + 8}`}
      >
        {/* Background circle */}
        <circle
          cx={radius + 4}
          cy={radius + 4}
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          fill="transparent"
          className="text-gray-200"
        />
        
        {/* Progress circle */}
        <circle
          cx={radius + 4}
          cy={radius + 4}
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          fill="transparent"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          className="text-primary-600 transition-all duration-300"
          strokeLinecap="round"
        />
      </svg>
      
      {showText && (
        <div className={clsx(
          'absolute inset-0 flex items-center justify-center',
          textSizes[size],
          'font-semibold text-gray-900'
        )}>
          {Math.round(percentage)}%
        </div>
      )}
    </div>
  );
}

interface AnnotationStatsProps {
  total: number;
  completed: number;
  pending: number;
  className?: string;
}

export function AnnotationStats({ 
  total, 
  completed, 
  pending, 
  className 
}: AnnotationStatsProps) {
  const completionPercentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className={clsx('bg-white rounded-lg p-6 border border-gray-200', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Annotation Progress</h3>
        <CircularProgress percentage={completionPercentage} size="md" />
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{total}</div>
          <div className="text-sm text-gray-600">Total</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{completed}</div>
          <div className="text-sm text-gray-600">Completed</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-600">{pending}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Progress</span>
          <span>{Math.round(completionPercentage)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
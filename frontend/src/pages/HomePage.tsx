import { Link } from 'react-router-dom';
import { Activity, Database, Zap, BarChart3 } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            PyroAnnotator
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Professional wildfire detection annotation tool for reviewing and labeling 
            image sequences with AI-assisted predictions.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-12">
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <Database className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Sequence Management
            </h3>
            <p className="text-gray-600">
              Browse, filter, and manage wildfire detection sequences from multiple sources 
              with advanced search capabilities.
            </p>
          </div>

          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <Activity className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Annotation Interface
            </h3>
            <p className="text-gray-600">
              Streamlined annotation workflow with GIF visualization, multi-label 
              classification, and batch processing capabilities.
            </p>
          </div>

          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <BarChart3 className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Progress Dashboard
            </h3>
            <p className="text-gray-600">
              Track annotation progress in real-time with visual indicators and 
              comprehensive reporting tools.
            </p>
          </div>
        </div>

        <div className="text-center space-x-4">
          <Link
            to="/dashboard"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200"
          >
            <BarChart3 className="w-5 h-5 mr-2" />
            View Dashboard
          </Link>
          <Link
            to="/sequences"
            className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200"
          >
            Start Annotating
          </Link>
        </div>
      </div>
    </div>
  );
}
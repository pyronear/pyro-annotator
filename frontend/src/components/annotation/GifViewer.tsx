import { useState } from 'react';
import { Play, Pause, RotateCcw, AlertTriangle } from 'lucide-react';
import { GifBboxUrls } from '@/types/api';

interface GifViewerProps {
  gifData: GifBboxUrls;
  bboxIndex: number;
  className?: string;
}

export default function GifViewer({ gifData, bboxIndex, className = '' }: GifViewerProps) {
  const [playingMain, setPlayingMain] = useState(true);
  const [playingCrop, setPlayingCrop] = useState(true);
  const [mainError, setMainError] = useState(false);
  const [cropError, setCropError] = useState(false);
  const [mainLoading, setMainLoading] = useState(true);
  const [cropLoading, setCropLoading] = useState(true);

  const handleMainLoad = () => setMainLoading(false);
  const handleCropLoad = () => setCropLoading(false);
  const handleMainError = () => {
    setMainError(true);
    setMainLoading(false);
  };
  const handleCropError = () => {
    setCropError(true);
    setCropLoading(false);
  };

  const toggleMainPlay = () => setPlayingMain(!playingMain);
  const toggleCropPlay = () => setPlayingCrop(!playingCrop);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          Sequence Bbox #{bboxIndex + 1}
        </h3>
        <div className="text-xs text-gray-500">
          Generated: {new Date(gifData.main_expires_at).toLocaleString()}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Main GIF */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">Main View</h4>
            <div className="flex items-center space-x-2">
              <button
                onClick={toggleMainPlay}
                disabled={mainError || !gifData.has_main}
                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {playingMain ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => window.location.reload()}
                disabled={mainError || !gifData.has_main}
                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="relative bg-gray-100 rounded-lg overflow-hidden aspect-video">
            {mainLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
            
            {mainError || !gifData.has_main ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <AlertTriangle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">
                    {!gifData.has_main ? 'Main GIF not available' : 'Failed to load GIF'}
                  </p>
                </div>
              </div>
            ) : (
              <img
                src={gifData.main_url}
                alt={`Main GIF for bbox ${bboxIndex + 1}`}
                className="w-full h-full object-contain"
                onLoad={handleMainLoad}
                onError={handleMainError}
                style={{
                  animationPlayState: playingMain ? 'running' : 'paused'
                }}
              />
            )}
          </div>
        </div>

        {/* Crop GIF */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">Cropped View</h4>
            <div className="flex items-center space-x-2">
              <button
                onClick={toggleCropPlay}
                disabled={cropError || !gifData.has_crop}
                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {playingCrop ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => window.location.reload()}
                disabled={cropError || !gifData.has_crop}
                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="relative bg-gray-100 rounded-lg overflow-hidden aspect-square">
            {cropLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
            
            {cropError || !gifData.has_crop ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <AlertTriangle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">
                    {!gifData.has_crop ? 'Crop GIF not available' : 'Failed to load GIF'}
                  </p>
                </div>
              </div>
            ) : (
              <img
                src={gifData.crop_url}
                alt={`Crop GIF for bbox ${bboxIndex + 1}`}
                className="w-full h-full object-contain"
                onLoad={handleCropLoad}
                onError={handleCropError}
                style={{
                  animationPlayState: playingCrop ? 'running' : 'paused'
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* URL Expiration Warning */}
      {(gifData.main_expires_at || gifData.crop_expires_at) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
          <div className="flex">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5" />
            <div className="ml-2">
              <p className="text-sm text-yellow-700">
                GIF URLs expire at{' '}
                {new Date(gifData.main_expires_at).toLocaleString()}
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                Refresh the page if GIFs stop loading
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
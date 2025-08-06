import { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { clsx } from 'clsx';

interface GifViewerProps {
  mainGifUrl?: string;
  cropGifUrl?: string;
  title?: string;
  onLoad?: () => void;
  className?: string;
}

type ViewMode = 'main' | 'crop' | 'side-by-side';

export default function GifViewer({ 
  mainGifUrl, 
  cropGifUrl, 
  title,
  onLoad,
  className 
}: GifViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [isPlaying, setIsPlaying] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mainImageRef = useRef<HTMLImageElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasMainGif = Boolean(mainGifUrl);
  const hasCropGif = Boolean(cropGifUrl);
  const hasBothGifs = hasMainGif && hasCropGif;

  useEffect(() => {
    if (!hasMainGif && !hasCropGif) {
      setLoadError('No GIF URLs provided');
      setIsLoading(false);
      return;
    }

    // Determine initial view mode based on available GIFs
    if (hasBothGifs) {
      setViewMode('side-by-side');
    } else if (hasMainGif) {
      setViewMode('main');
    } else if (hasCropGif) {
      setViewMode('crop');
    }
  }, [mainGifUrl, cropGifUrl]);

  const handleImageLoad = () => {
    setIsLoading(false);
    setLoadError(null);
    onLoad?.();
  };

  const handleImageError = () => {
    setIsLoading(false);
    setLoadError('Failed to load GIF');
  };

  const togglePlayPause = () => {
    const images = [mainImageRef.current, cropImageRef.current].filter(Boolean);
    
    images.forEach(img => {
      if (img) {
        if (isPlaying) {
          // Pause by setting the src to itself (stops animation)
          const currentSrc = img.src;
          img.src = '';
          img.src = currentSrc;
        } else {
          // Resume by reloading the image
          const currentSrc = img.src;
          img.src = '';
          img.src = currentSrc;
        }
      }
    });
    
    setIsPlaying(!isPlaying);
  };

  const resetGif = () => {
    const images = [mainImageRef.current, cropImageRef.current].filter(Boolean);
    
    images.forEach(img => {
      if (img) {
        const currentSrc = img.src;
        img.src = '';
        img.src = currentSrc;
      }
    });
    
    setIsPlaying(true);
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 25, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 25, 25));
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (loadError) {
    return (
      <div className={clsx('card p-8 text-center', className)}>
        <div className="text-red-500 mb-2">⚠️ {loadError}</div>
        <p className="text-gray-500 text-sm">
          Please check that the GIF files are accessible
        </p>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={clsx(
        'card overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50 bg-black',
        className
      )}
    >
      {/* Header with controls */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          {title && (
            <h3 className="text-lg font-medium text-gray-900">{title}</h3>
          )}
          {isLoading && (
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <div className="animate-spin w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full"></div>
              <span>Loading...</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* View mode selector */}
          {hasBothGifs && (
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              <option value="main">Main View</option>
              <option value="crop">Crop View</option>
              <option value="side-by-side">Side by Side</option>
            </select>
          )}

          {/* Playback controls */}
          <button
            onClick={togglePlayPause}
            className="p-1 rounded hover:bg-gray-100"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <button
            onClick={resetGif}
            className="p-1 rounded hover:bg-gray-100"
            title="Reset"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Zoom controls */}
          <div className="flex items-center space-x-1 border-l border-gray-300 pl-2">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded hover:bg-gray-100"
              title="Zoom Out"
              disabled={zoom <= 25}
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            
            <span className="text-sm font-mono w-12 text-center">
              {zoom}%
            </span>
            
            <button
              onClick={handleZoomIn}
              className="p-1 rounded hover:bg-gray-100"
              title="Zoom In"
              disabled={zoom >= 200}
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-1 rounded hover:bg-gray-100"
            title="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* GIF display area */}
      <div className="p-4 bg-gray-50 overflow-auto">
        <div 
          className={clsx(
            'flex gap-4 justify-center items-start',
            viewMode === 'side-by-side' ? 'flex-row' : 'flex-col items-center'
          )}
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center top' }}
        >
          {/* Main GIF */}
          {(viewMode === 'main' || viewMode === 'side-by-side') && hasMainGif && (
            <div className="text-center">
              {viewMode === 'side-by-side' && (
                <h4 className="text-sm font-medium text-gray-700 mb-2">Full Sequence</h4>
              )}
              <img
                ref={mainImageRef}
                src={mainGifUrl}
                alt="Main sequence GIF"
                onLoad={handleImageLoad}
                onError={handleImageError}
                className="max-w-full h-auto border border-gray-300 rounded shadow-sm"
              />
            </div>
          )}

          {/* Crop GIF */}
          {(viewMode === 'crop' || viewMode === 'side-by-side') && hasCropGif && (
            <div className="text-center">
              {viewMode === 'side-by-side' && (
                <h4 className="text-sm font-medium text-gray-700 mb-2">Cropped View</h4>
              )}
              <img
                ref={cropImageRef}
                src={cropGifUrl}
                alt="Cropped sequence GIF"
                onLoad={handleImageLoad}
                onError={handleImageError}
                className="max-w-full h-auto border border-gray-300 rounded shadow-sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer with info */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>
            {viewMode === 'side-by-side' ? 'Side by side view' : 
             viewMode === 'main' ? 'Full sequence view' : 'Cropped view'}
          </span>
          <span>Zoom: {zoom}%</span>
        </div>
      </div>
    </div>
  );
}
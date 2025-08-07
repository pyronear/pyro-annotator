import { useState, useEffect, useRef } from 'react';
import { Detection } from '@/types/api';
import { apiClient } from '@/services/api';

interface PreloadedImage {
  url: string;
  loaded: boolean;
  error: boolean;
}

interface ImagePreloaderOptions {
  preloadAhead?: number; // Number of images to preload ahead
  preloadBehind?: number; // Number of images to keep cached behind
}

/**
 * Hook to preload multiple detection images for smooth playback
 * Uses a sliding window approach to preload images around the current index
 */
export function useImagePreloader(
  detections: Detection[],
  currentIndex: number,
  options: ImagePreloaderOptions = {}
) {
  const { preloadAhead = 10, preloadBehind = 5 } = options;
  
  // Track loaded images
  const [imageCache, setImageCache] = useState<Record<number, PreloadedImage>>({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  // Keep references to Image objects to prevent garbage collection
  const imageRefs = useRef<Record<number, HTMLImageElement>>({});
  const loadingQueue = useRef<Set<number>>(new Set());
  
  // Calculate which images should be preloaded
  const getPreloadRange = () => {
    const start = Math.max(0, currentIndex - preloadBehind);
    const end = Math.min(detections.length - 1, currentIndex + preloadAhead);
    return { start, end };
  };
  
  // Preload a single image
  const preloadImage = async (detection: Detection) => {
    if (imageCache[detection.id]?.loaded || loadingQueue.current.has(detection.id)) {
      return;
    }
    
    loadingQueue.current.add(detection.id);
    
    try {
      // Fetch the image URL from the API
      const { url } = await apiClient.getDetectionImageUrl(detection.id);
      
      // Create an Image object to preload
      const img = new Image();
      imageRefs.current[detection.id] = img;
      
      // Set up promise-based loading
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          setImageCache(prev => ({
            ...prev,
            [detection.id]: { url, loaded: true, error: false }
          }));
          resolve();
        };
        
        img.onerror = () => {
          setImageCache(prev => ({
            ...prev,
            [detection.id]: { url, loaded: false, error: true }
          }));
          reject(new Error(`Failed to load image for detection ${detection.id}`));
        };
        
        // Start loading
        img.src = url;
      });
    } catch (error) {
      console.error(`Error preloading image for detection ${detection.id}:`, error);
      setImageCache(prev => ({
        ...prev,
        [detection.id]: { url: '', loaded: false, error: true }
      }));
    } finally {
      loadingQueue.current.delete(detection.id);
    }
  };
  
  // Preload images in the sliding window
  useEffect(() => {
    if (!detections || detections.length === 0) return;
    
    const { start, end } = getPreloadRange();
    const preloadPromises: Promise<void>[] = [];
    
    // Priority order: current image first, then ahead, then behind
    const indicesToPreload: number[] = [];
    
    // Current image has highest priority
    if (detections[currentIndex]) {
      indicesToPreload.push(currentIndex);
    }
    
    // Then preload ahead (for smooth forward playback)
    for (let i = currentIndex + 1; i <= end; i++) {
      indicesToPreload.push(i);
    }
    
    // Finally preload behind (for scrubbing backwards)
    for (let i = currentIndex - 1; i >= start; i--) {
      indicesToPreload.push(i);
    }
    
    // Start preloading
    indicesToPreload.forEach(index => {
      if (detections[index]) {
        preloadPromises.push(preloadImage(detections[index]));
      }
    });
    
    // Mark initial loading complete when current image is loaded
    if (detections[currentIndex] && !imageCache[detections[currentIndex].id]?.loaded) {
      preloadImage(detections[currentIndex]).then(() => {
        setIsInitialLoading(false);
      });
    } else if (detections[currentIndex]) {
      setIsInitialLoading(false);
    }
    
    // Clean up images outside the window to free memory
    const allDetectionIds = new Set(detections.map(d => d.id));
    const windowDetectionIds = new Set(
      detections.slice(start, end + 1).map(d => d.id)
    );
    
    Object.keys(imageRefs.current).forEach(idStr => {
      const id = parseInt(idStr);
      if (!windowDetectionIds.has(id) && allDetectionIds.has(id)) {
        // Remove from cache and refs for images outside the window
        delete imageRefs.current[id];
        setImageCache(prev => {
          const newCache = { ...prev };
          delete newCache[id];
          return newCache;
        });
      }
    });
  }, [detections, currentIndex, preloadAhead, preloadBehind]);
  
  // Get current image info
  const currentImage = detections[currentIndex] 
    ? imageCache[detections[currentIndex].id] 
    : null;
  
  // Check if an image at a specific index is ready
  const isImageReady = (index: number): boolean => {
    if (!detections[index]) return false;
    const cached = imageCache[detections[index].id];
    return cached?.loaded === true;
  };
  
  // Get preload progress
  const getPreloadProgress = () => {
    const { start, end } = getPreloadRange();
    const totalToPreload = end - start + 1;
    let loadedCount = 0;
    
    for (let i = start; i <= end; i++) {
      if (detections[i] && imageCache[detections[i].id]?.loaded) {
        loadedCount++;
      }
    }
    
    return {
      loaded: loadedCount,
      total: totalToPreload,
      percentage: totalToPreload > 0 ? (loadedCount / totalToPreload) * 100 : 0
    };
  };
  
  return {
    currentImage,
    imageCache,
    isInitialLoading,
    isImageReady,
    getPreloadProgress,
    preloadImage
  };
}
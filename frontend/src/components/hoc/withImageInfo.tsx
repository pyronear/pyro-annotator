/**
 * Higher-Order Component for providing image dimension calculations
 * 
 * This HOC encapsulates the common pattern of measuring DOM elements
 * and providing pure coordinate transformation functions to components.
 * It separates the impure DOM measurement from pure calculation functions.
 */

import React, { useState, useRef, useCallback, ComponentType } from 'react';
import { ImageInfo } from '@/utils/coordinate-transforms';
import { 
  screenToImageCoordinates, 
  imageToNormalized, 
  normalizedToImage,
  ContainerInfo,
  NaturalImageInfo 
} from '@/utils/coordinate-transforms';

/**
 * Props that will be injected by the HOC
 */
export interface WithImageInfoProps {
  /** Current image dimension and positioning information */
  readonly imageInfo: ImageInfo | null;
  /** Ref for the container element */
  readonly containerRef: React.RefObject<HTMLDivElement>;
  /** Ref for the image element */
  readonly imageRef: React.RefObject<HTMLImageElement>;
  /** Function to trigger image info recalculation */
  readonly updateImageInfo: () => void;
  /** Pure coordinate transformation functions */
  readonly coordinateTransforms: {
    readonly screenToImage: (screenX: number, screenY: number) => { x: number; y: number } | null;
    readonly imageToNormalized: (imageX: number, imageY: number) => { x: number; y: number } | null;
    readonly normalizedToImage: (normX: number, normY: number) => { x: number; y: number } | null;
  };
}

/**
 * Options for configuring the HOC behavior
 */
export interface WithImageInfoOptions {
  /** Whether to automatically update on window resize */
  readonly autoResize?: boolean;
  /** Debounce delay for resize updates in milliseconds */
  readonly resizeDebounce?: number;
}

/**
 * Higher-Order Component that provides image dimension calculations
 * 
 * This HOC handles the impure aspects of DOM measurement while providing
 * pure coordinate transformation functions to the wrapped component.
 * 
 * @param Component - The component to wrap
 * @param options - Configuration options
 * @returns Enhanced component with image info capabilities
 * 
 * @example
 * interface MyComponentProps extends WithImageInfoProps {
 *   readonly title: string;
 * }
 * 
 * const MyComponent = ({ title, imageInfo, coordinateTransforms }: MyComponentProps) => {
 *   if (!imageInfo) return <div>Loading...</div>;
 *   
 *   return (
 *     <div>
 *       <h1>{title}</h1>
 *       <p>Image size: {imageInfo.width}x{imageInfo.height}</p>
 *     </div>
 *   );
 * };
 * 
 * export default withImageInfo(MyComponent, { autoResize: true });
 */
export const withImageInfo = <P extends WithImageInfoProps>(
  Component: ComponentType<P>,
  options: WithImageInfoOptions = {}
) => {
  const {
    autoResize = true,
    resizeDebounce = 150
  } = options;

  const WithImageInfoComponent = (props: Omit<P, keyof WithImageInfoProps>) => {
    const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const resizeTimeoutRef = useRef<NodeJS.Timeout>();

    /**
     * Pure function to calculate image info from DOM elements
     * 
     * @pure Calculation is deterministic based on DOM state
     */
    const calculateImageInfo = (): ImageInfo | null => {
      if (!imageRef.current || !containerRef.current) {
        return null;
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imageRef.current.getBoundingClientRect();

      return {
        width: imgRect.width,
        height: imgRect.height,
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top
      };
    };

    /**
     * Updates image info by measuring current DOM state
     */
    const updateImageInfo = useCallback(() => {
      const newImageInfo = calculateImageInfo();
      setImageInfo(newImageInfo);
    }, []);

    /**
     * Debounced resize handler
     */
    const handleResize = useCallback(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      
      resizeTimeoutRef.current = setTimeout(() => {
        updateImageInfo();
      }, resizeDebounce);
    }, [updateImageInfo, resizeDebounce]);

    /**
     * Pure coordinate transformation functions
     * These functions are memoized and use the current imageInfo
     */
    const coordinateTransforms = React.useMemo(() => {
      if (!imageInfo || !imageRef.current || !containerRef.current) {
        return {
          screenToImage: () => null,
          imageToNormalized: () => null,
          normalizedToImage: () => null
        };
      }

      const containerInfo: ContainerInfo = {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      };

      const naturalImageInfo: NaturalImageInfo = {
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight
      };

      const transform = {
        zoomLevel: 1,
        panOffset: { x: 0, y: 0 },
        transformOrigin: { x: 50, y: 50 }
      };

      return {
        screenToImage: (screenX: number, screenY: number) => {
          try {
            return screenToImageCoordinates(
              screenX, 
              screenY, 
              imageInfo, 
              transform, 
              containerInfo, 
              naturalImageInfo
            );
          } catch (error) {
            console.warn('Error in screenToImage coordinate transformation:', error);
            return null;
          }
        },
        
        imageToNormalized: (imageX: number, imageY: number) => {
          try {
            return imageToNormalized(imageX, imageY, containerInfo, naturalImageInfo);
          } catch (error) {
            console.warn('Error in imageToNormalized coordinate transformation:', error);
            return null;
          }
        },
        
        normalizedToImage: (normX: number, normY: number) => {
          try {
            return normalizedToImage(normX, normY, containerInfo, naturalImageInfo);
          } catch (error) {
            console.warn('Error in normalizedToImage coordinate transformation:', error);
            return null;
          }
        }
      };
    }, [imageInfo]);

    // Set up resize listener
    React.useEffect(() => {
      if (!autoResize) return;

      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    }, [autoResize, handleResize]);

    // Enhanced props to pass to the wrapped component
    const enhancedProps: P = {
      ...props,
      imageInfo,
      containerRef,
      imageRef,
      updateImageInfo,
      coordinateTransforms
    } as P;

    return <Component {...enhancedProps} />;
  };

  WithImageInfoComponent.displayName = `withImageInfo(${Component.displayName || Component.name || 'Component'})`;

  return WithImageInfoComponent;
};

/**
 * Hook version for use with functional components that prefer hooks over HOCs
 * 
 * @param options - Configuration options
 * @returns Image info state and functions
 * 
 * @example
 * const MyComponent = () => {
 *   const { imageInfo, containerRef, imageRef, updateImageInfo, coordinateTransforms } = useImageInfo({
 *     autoResize: true
 *   });
 *   
 *   return (
 *     <div ref={containerRef}>
 *       <img ref={imageRef} onLoad={updateImageInfo} />
 *     </div>
 *   );
 * };
 */
export const useImageInfo = (options: WithImageInfoOptions = {}) => {
  const {
    autoResize = true,
    resizeDebounce = 150
  } = options;

  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout>();

  const calculateImageInfo = (): ImageInfo | null => {
    if (!imageRef.current || !containerRef.current) {
      return null;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const imgRect = imageRef.current.getBoundingClientRect();

    return {
      width: imgRect.width,
      height: imgRect.height,
      offsetX: imgRect.left - containerRect.left,
      offsetY: imgRect.top - containerRect.top
    };
  };

  const updateImageInfo = useCallback(() => {
    const newImageInfo = calculateImageInfo();
    setImageInfo(newImageInfo);
  }, []);

  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    
    resizeTimeoutRef.current = setTimeout(() => {
      updateImageInfo();
    }, resizeDebounce);
  }, [updateImageInfo, resizeDebounce]);

  const coordinateTransforms = React.useMemo(() => {
    if (!imageInfo || !imageRef.current || !containerRef.current) {
      return {
        screenToImage: () => null,
        imageToNormalized: () => null,
        normalizedToImage: () => null
      };
    }

    const containerInfo: ContainerInfo = {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    };

    const naturalImageInfo: NaturalImageInfo = {
      width: imageRef.current.naturalWidth,
      height: imageRef.current.naturalHeight
    };

    const transform = {
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
      transformOrigin: { x: 50, y: 50 }
    };

    return {
      screenToImage: (screenX: number, screenY: number) => {
        try {
          return screenToImageCoordinates(
            screenX, 
            screenY, 
            imageInfo, 
            transform, 
            containerInfo, 
            naturalImageInfo
          );
        } catch (error) {
          console.warn('Error in screenToImage coordinate transformation:', error);
          return null;
        }
      },
      
      imageToNormalized: (imageX: number, imageY: number) => {
        try {
          return imageToNormalized(imageX, imageY, containerInfo, naturalImageInfo);
        } catch (error) {
          console.warn('Error in imageToNormalized coordinate transformation:', error);
          return null;
        }
      },
      
      normalizedToImage: (normX: number, normY: number) => {
        try {
          return normalizedToImage(normX, normY, containerInfo, naturalImageInfo);
        } catch (error) {
          console.warn('Error in normalizedToImage coordinate transformation:', error);
          return null;
        }
      }
    };
  }, [imageInfo]);

  React.useEffect(() => {
    if (!autoResize) return;

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [autoResize, handleResize]);

  return {
    imageInfo,
    containerRef,
    imageRef,
    updateImageInfo,
    coordinateTransforms
  };
};
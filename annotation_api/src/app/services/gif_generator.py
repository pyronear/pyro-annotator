# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import logging
from datetime import datetime
from io import BytesIO
from typing import List

import cv2
import imageio
import numpy as np
from fastapi import HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select

from app.models import Detection, SequenceAnnotation
from app.schemas.annotation_validation import SequenceBBox, SequenceAnnotationData
from app.services.storage import s3_service

__all__ = ["SequenceGifGenerator", "GifGenerationError"]

logger = logging.getLogger("uvicorn.warning")


class GifGenerationError(Exception):
    """Custom exception for GIF generation errors."""
    pass


class SequenceGifGenerator:
    """
    Service for generating GIFs from sequence detection images.
    
    Generates both main (full-frame with bbox overlay) and crop GIFs
    for sequence annotations, adapting the logic from the original utils.py.
    """
    
    def __init__(self, session: AsyncSession):
        self.session = session
        
    async def generate_gifs_for_annotation(self, annotation_id: int) -> dict:
        """
        Generate GIFs for a sequence annotation and update the annotation with URLs.
        
        Args:
            annotation_id: The sequence annotation ID to generate GIFs for
            
        Returns:
            dict: Contains gif_urls and generation metadata
            
        Raises:
            HTTPException: If annotation not found or GIF generation fails
        """
        # Get the annotation
        annotation = await self._get_annotation(annotation_id)
        
        # Parse annotation data
        annotation_data = SequenceAnnotationData(**annotation.annotation)
        
        if not annotation_data.sequences_bbox:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No sequence bounding boxes found in annotation"
            )
        
        # Get sequence detections
        detections = await self._get_sequence_detections(annotation.sequence_id)
        
        if not detections:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, 
                detail="No detections found for sequence"
            )
        
        # Generate GIFs for each sequence bbox
        updated_sequences_bbox = []
        
        for bbox_data in annotation_data.sequences_bbox:
            if bbox_data.bboxes:  # Only generate GIFs if there are bounding boxes
                try:
                    gif_urls = await self._generate_gifs_for_bbox(bbox_data, detections)
                    
                    # Update the bbox data with GIF URLs
                    bbox_data.gif_url_main = gif_urls.get("main")
                    bbox_data.gif_url_crop = gif_urls.get("crop")
                    
                except Exception as e:
                    logger.error(f"Failed to generate GIFs for bbox in annotation {annotation_id}: {str(e)}")
                    # Continue with other bboxes, but log the error
            
            updated_sequences_bbox.append(bbox_data)
        
        # Update the annotation with new GIF URLs
        updated_annotation_data = SequenceAnnotationData(sequences_bbox=updated_sequences_bbox)
        await self._update_annotation_gifs(annotation_id, updated_annotation_data)
        
        # Count successful GIF generations
        gif_count = sum(
            1 for bbox in updated_sequences_bbox 
            if bbox.gif_url_main or bbox.gif_url_crop
        )
        
        return {
            "annotation_id": annotation_id,
            "sequence_id": annotation.sequence_id,
            "gif_count": gif_count,
            "total_bboxes": len(updated_sequences_bbox),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _get_annotation(self, annotation_id: int) -> SequenceAnnotation:
        """Get sequence annotation by ID."""
        query = select(SequenceAnnotation).where(SequenceAnnotation.id == annotation_id)
        result = await self.session.exec(query)
        annotation = result.one_or_none()
        
        if not annotation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sequence annotation not found"
            )
        
        return annotation
    
    async def _get_sequence_detections(self, sequence_id: int) -> List[Detection]:
        """Get all detections for a sequence, ordered by recorded_at."""
        query = (
            select(Detection)
            .where(Detection.sequence_id == sequence_id)
            .order_by(Detection.recorded_at)
        )
        result = await self.session.exec(query)
        return list(result.all())
    
    async def _generate_gifs_for_bbox(self, bbox_data: SequenceBBox, detections: List[Detection]) -> dict:
        """
        Generate main and crop GIFs for a sequence bounding box.
        
        Args:
            bbox_data: SequenceBBox containing bounding box information
            detections: List of Detection objects for the sequence
            
        Returns:
            dict: Contains 'main' and 'crop' GIF URLs
        """
        # Get detection images referenced in the bbox
        relevant_detections = []
        detection_bboxes = {}
        
        for bbox in bbox_data.bboxes:
            detection = next((d for d in detections if d.id == bbox.detection_id), None)
            if detection:
                relevant_detections.append(detection)
                detection_bboxes[detection.id] = bbox.xyxyn
        
        if not relevant_detections:
            raise GifGenerationError("No valid detections found for bounding boxes")
        
        # Download images from S3
        bucket_name = s3_service.resolve_bucket_name()
        bucket = s3_service.get_bucket(bucket_name)
        
        images = []
        for detection in relevant_detections:
            try:
                image_data = bucket.download_file(detection.bucket_key)
                image = self._load_image_from_bytes(image_data)
                images.append((image, detection.id))
            except Exception as e:
                logger.warning(f"Failed to load image for detection {detection.id}: {str(e)}")
                continue
        
        if not images:
            raise GifGenerationError("Failed to load any detection images")
        
        # Generate timestamp for unique naming
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        sequence_id = relevant_detections[0].sequence_id
        
        gif_urls = {}
        
        # Generate main GIF (full frame with bbox overlay)
        if images:
            try:
                main_frames = []
                for image, detection_id in images:
                    if detection_id in detection_bboxes:
                        frame_with_bbox = self._draw_bbox_on_image(
                            image.copy(), detection_bboxes[detection_id]
                        )
                        main_frames.append(frame_with_bbox)
                
                if main_frames:
                    main_gif_key = f"gifs/sequence_{sequence_id}/main_{timestamp}.gif"
                    main_gif_data = self._create_gif_bytes(main_frames)
                    bucket.upload_file_bytes(main_gif_data, main_gif_key, "image/gif")
                    gif_urls["main"] = bucket.get_public_url(main_gif_key)
                    
            except Exception as e:
                logger.error(f"Failed to generate main GIF: {str(e)}")
        
        # Generate crop GIF (cropped region around bbox)
        if images and detection_bboxes:
            try:
                # Calculate average bounding box for cropping
                avg_bbox = self._calculate_average_bbox(list(detection_bboxes.values()))
                
                crop_frames = []
                for image, detection_id in images:
                    if detection_id in detection_bboxes:
                        cropped_frame = self._crop_image(image, avg_bbox)
                        crop_frames.append(cropped_frame)
                
                if crop_frames:
                    crop_gif_key = f"gifs/sequence_{sequence_id}/crop_{timestamp}.gif"
                    crop_gif_data = self._create_gif_bytes(crop_frames)
                    bucket.upload_file_bytes(crop_gif_data, crop_gif_key, "image/gif")
                    gif_urls["crop"] = bucket.get_public_url(crop_gif_key)
                    
            except Exception as e:
                logger.error(f"Failed to generate crop GIF: {str(e)}")
        
        return gif_urls
    
    def _load_image_from_bytes(self, image_bytes: bytes) -> np.ndarray:
        """Load image from bytes using OpenCV."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise GifGenerationError("Failed to decode image")
        return image
    
    def _draw_bbox_on_image(self, image: np.ndarray, xyxyn: List[float]) -> np.ndarray:
        """Draw bounding box on image (normalized coordinates)."""
        h, w = image.shape[:2]
        x1, y1, x2, y2 = xyxyn
        
        # Convert normalized to absolute coordinates
        x1, y1, x2, y2 = int(x1 * w), int(y1 * h), int(x2 * w), int(y2 * h)
        
        # Draw rectangle
        cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 3)  # Green box
        
        return image
    
    def _crop_image(self, image: np.ndarray, xyxyn: List[float], padding: float = 0.1) -> np.ndarray:
        """Crop image around bounding box with padding."""
        h, w = image.shape[:2]
        x1, y1, x2, y2 = xyxyn
        
        # Add padding
        pad_x = (x2 - x1) * padding
        pad_y = (y2 - y1) * padding
        
        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y) 
        x2 = min(1, x2 + pad_x)
        y2 = min(1, y2 + pad_y)
        
        # Convert to absolute coordinates
        x1, y1, x2, y2 = int(x1 * w), int(y1 * h), int(x2 * w), int(y2 * h)
        
        return image[y1:y2, x1:x2]
    
    def _calculate_average_bbox(self, bboxes: List[List[float]]) -> List[float]:
        """Calculate average bounding box from multiple boxes."""
        if not bboxes:
            return [0, 0, 1, 1]
        
        avg_x1 = sum(bbox[0] for bbox in bboxes) / len(bboxes)
        avg_y1 = sum(bbox[1] for bbox in bboxes) / len(bboxes)
        avg_x2 = sum(bbox[2] for bbox in bboxes) / len(bboxes)
        avg_y2 = sum(bbox[3] for bbox in bboxes) / len(bboxes)
        
        return [avg_x1, avg_y1, avg_x2, avg_y2]
    
    def _create_gif_bytes(self, frames: List[np.ndarray], duration: float = 0.5) -> bytes:
        """
        Create GIF bytes from image frames using high-quality settings.
        Adapted from the original create_high_quality_gif function.
        """
        if not frames:
            raise GifGenerationError("No frames provided for GIF creation")
        
        # Convert BGR to RGB for imageio
        rgb_frames = []
        for frame in frames:
            if len(frame.shape) == 3:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            else:
                rgb_frame = frame
            rgb_frames.append(rgb_frame)
        
        # Create GIF in memory
        gif_buffer = BytesIO()
        
        try:
            imageio.mimsave(
                gif_buffer,
                rgb_frames,
                format='GIF',
                duration=duration,
                quantizer='nq',  # NeuQuant quantization for better quality
                palettesize=256,
                loop=0  # Infinite loop
            )
            
            gif_buffer.seek(0)
            return gif_buffer.getvalue()
            
        except Exception as e:
            raise GifGenerationError(f"Failed to create GIF: {str(e)}")
    
    async def _update_annotation_gifs(
        self, 
        annotation_id: int, 
        annotation_data: SequenceAnnotationData
    ) -> None:
        """Update sequence annotation with generated GIF URLs."""
        query = select(SequenceAnnotation).where(SequenceAnnotation.id == annotation_id)
        result = await self.session.exec(query)
        annotation = result.one_or_none()
        
        if annotation:
            annotation.annotation = annotation_data.model_dump()
            annotation.updated_at = datetime.utcnow()
            
            self.session.add(annotation)
            await self.session.commit()
            await self.session.refresh(annotation)
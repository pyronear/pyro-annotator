import glob
import os
import pathlib

import cv2
import imageio
import numpy as np


def xywh2xyxy(x):
    """Function to convert bounding box format from center to top-left corner"""
    y = np.zeros_like(x)
    y[0] = x[0] - x[2] / 2  # x_min
    y[1] = x[1] - x[3] / 2  # y_min
    y[2] = x[0] + x[2] / 2  # x_max
    y[3] = x[1] + x[3] / 2  # y_max
    return y


def box_iou(box1: np.ndarray, box2: np.ndarray, eps: float = 1e-7):
    """
    Calculate intersection-over-union (IoU) of boxes.
    Both sets of boxes are expected to be in (x1, y1, x2, y2) format.
    Based on https://github.com/pytorch/vision/blob/master/torchvision/ops/boxes.py

    Args:
        box1 (np.ndarray): A numpy array of shape (N, 4) representing N bounding boxes.
        box2 (np.ndarray): A numpy array of shape (M, 4) representing M bounding boxes.
        eps (float, optional): A small value to avoid division by zero. Defaults to 1e-7.

    Returns:
        (np.ndarray): An NxM numpy array containing the pairwise IoU values for every element in box1 and box2.
    """
    # Ensure box1 and box2 are in the shape (N, 4) even if N is 1
    if box1.ndim == 1:
        box1 = box1.reshape(1, 4)
    if box2.ndim == 1:
        box2 = box2.reshape(1, 4)

    (a1, a2), (b1, b2) = np.split(box1, 2, 1), np.split(box2, 2, 1)
    inter = (np.minimum(a2, b2[:, None, :]) - np.maximum(a1, b1[:, None, :])).clip(0).prod(2)

    # IoU = inter / (area1 + area2 - inter)
    return inter / ((a2 - a1).prod(1) + (b2 - b1).prod(1)[:, None] - inter + eps)


def nms(boxes: np.ndarray, overlapThresh: int = 0):
    """Non maximum suppression

    Args:
        boxes (np.ndarray): A numpy array of shape (N, 4) representing N bounding boxes in (x1, y1, x2, y2, conf) format
        overlapThresh (int, optional): iou threshold. Defaults to 0.

    Returns:
        boxes: Boxes after NMS
    """
    # Return an empty list, if no boxes given
    boxes = boxes[boxes[:, -1].argsort()]
    if len(boxes) == 0:
        return []

    indices = np.arange(len(boxes))
    rr = box_iou(boxes[:, :4], boxes[:, :4])
    for i, box in enumerate(boxes):
        temp_indices = indices[indices != i]
        if np.any(rr[i, temp_indices] > overlapThresh):
            indices = indices[indices != i]

    return boxes[indices]


def get_pred_name(img_file, img_folder_name="original", label_folder_name="labels"):
    dir_name, file_name = os.path.split(img_file)
    return os.path.join(
        dir_name.replace(img_folder_name, label_folder_name), "labels", file_name.replace(".jpg", ".txt")
    )


def read_file_preds(label_file):
    preds = []
    if pathlib.Path(label_file).is_file():
        with open(label_file, "r") as f:
            for line in f:
                x = np.array(line.strip().split(" ")[1:6]).astype(float)
                x[:4] = xywh2xyxy(x[:4])
                preds.append(x)

    return preds


def prepare_candidates_with_context(sequences_folder, iou_thresh=0.1, conf_thresh=0.1):
    """
    Loads predictions, applies NMS, matches candidates to their original files,
    and extracts context frames.

    Args:
        sequences_folder (str): Path to the root folder containing labels_predictions
        iou_thresh (float): IoU threshold for NMS
        conf_thresh (float): Confidence threshold for filtering candidates

    Returns:
        List[Tuple[candidate, candidate_file, context_files]]
    """
    predictions_files_folder = os.path.join(sequences_folder, "labels_predictions")
    predictions_files = glob.glob(f"{predictions_files_folder}/*.txt")
    predictions_files.sort()

    # Step 1: Read all predictions with file association
    preds_with_files = [(pred, label_file) for label_file in predictions_files for pred in read_file_preds(label_file)]

    if not preds_with_files:
        return []

    # Step 2: Separate data
    preds = np.array([p for p, _ in preds_with_files])
    files = [f for _, f in preds_with_files]

    # Step 3: Apply NMS and filter by confidence
    candidates = nms(preds, iou_thresh)
    candidates = candidates[candidates[:, -1] > conf_thresh]

    # Step 4: Match each candidate to its source file
    candidate_files = []
    for cand in candidates:
        idx = np.where((preds == cand).all(axis=1))[0]
        if len(idx) == 0:
            raise ValueError("Candidate not found in original preds")
        candidate_files.append(files[idx[0]])

    # Step 5: Build context (2 previous + current + 2 next) for each candidate
    context_files_per_candidate = []
    for file in candidate_files:
        idx = predictions_files.index(file)
        start = max(0, idx - 2)
        end = min(len(predictions_files), idx + 3)
        context_files = predictions_files[start:end]
        context_files_per_candidate.append(context_files)

    # Final output: zip everything
    return list(zip(candidates, candidate_files, context_files_per_candidate, strict=False))


def generate_candidate_gifs(i, candidate, context_files, out_dir):
    """
    Create full and cropped GIFs for a single candidate.

    Args:
        i (int): Candidate index
        candidate (np.ndarray): Array of shape (5,) with bbox and score
        context_files (List[str]): List of 5 label file paths (centered context)
        out_dir (str): Output directory to store GIFs
    """
    candidate_box = np.array(candidate[:4]).reshape(1, 4)
    gif_imgs = []
    clean_imgs = []

    for label_file in context_files:
        img_path = label_file.replace("labels_predictions", "images").replace(".txt", ".jpg")
        img = cv2.imread(img_path)

        if img is None:
            print(f"⚠️ Could not load image at {img_path}, skipping candidate {i}")
            return  # Skip this candidate if any image is missing

        img_h, img_w = img.shape[:2]
        draw_box = None

        preds = read_file_preds(label_file)
        if preds:
            preds = np.array(preds)
            pred_boxes = preds[:, :4]
            ious = box_iou(candidate_box, pred_boxes)[0]
            if np.max(ious) > 0:
                draw_box = pred_boxes[np.argmax(ious)].copy()

        if draw_box is None:
            draw_box = candidate_box[0].copy()

        draw_box[0::2] *= img_w
        draw_box[1::2] *= img_h
        x0, y0, x1, y1 = draw_box.astype(int)

        # Keep a clean version for cropping
        clean_img = img.copy()

        # Draw on a separate copy
        cv2.rectangle(img, (x0, y0), (x1, y1), (0, 0, 255), 2)
        cv2.putText(img, f"cand {i}", (x0, max(0, y0 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

        gif_imgs.append(img.copy())  # With box (for full GIF)
        clean_imgs.append(clean_img.copy())  # Without box (for crop GIF)

    if not gif_imgs or not clean_imgs:
        return

    os.makedirs(out_dir, exist_ok=True)

    # Save full-frame GIF
    gif_file = os.path.join(out_dir, f"candidate_{i:03d}.gif")
    create_high_quality_gif(gif_imgs, gif_file, duration=1)

    # Crop logic
    crop_x_center = (x0 + x1) // 2
    crop_y_center = (y0 + y1) // 2
    crop_size = max(112, (x1 - x0) + 20)

    crop_x_start = max(0, crop_x_center - crop_size // 2)
    crop_y_start = max(0, crop_y_center - crop_size // 2)
    crop_x_end = min(clean_imgs[0].shape[1], crop_x_start + crop_size)
    crop_y_end = min(clean_imgs[0].shape[0], crop_y_start + crop_size)
    crop_x_start = max(0, crop_x_end - crop_size)
    crop_y_start = max(0, crop_y_end - crop_size)

    # Crop all clean frames
    cropped_imgs = [im[crop_y_start:crop_y_end, crop_x_start:crop_x_end] for im in clean_imgs]

    # Save cropped GIF
    crop_gif_file = os.path.join(out_dir, f"crop_{i:03d}.gif")
    create_high_quality_gif(cropped_imgs, crop_gif_file, duration=1)


def create_high_quality_gif(image_list, output_path, duration=0.5):
    # Convert images from BGR (OpenCV format) to RGB
    rgb_images = [cv2.cvtColor(img, cv2.COLOR_BGR2RGB) for img in image_list]

    # Save as GIF using imageio with quality optimization
    imageio.mimsave(
        output_path,
        rgb_images,
        duration=duration,
        quantizer="nq",  # Use NeuQuant quantizer for better color matching
        palettesize=256,  # Maximum color palette size (GIF limit)
        optimize=True,  # Optimizes color palette
        loop=0,  # Set to loop infinitely
    )

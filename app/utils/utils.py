import cv2  # type: ignore[import-untyped]
import numpy as np
import torch

import numpy as np

from segment_anything import SamPredictor, sam_model_registry
from dash.exceptions import PreventUpdate

# Load Sam
sam_checkpoint = "sam_vit_h_4b8939.pth"
model_type = "vit_h"
device = "cpu"
sam = sam_model_registry[model_type](checkpoint=sam_checkpoint)
sam.to(device=device)
sam_predictor = SamPredictor(sam)


def load_image_embedding(path):
    res = torch.load(path, sam_predictor.device)
    for k, v in res.items():
        setattr(sam_predictor, k, v)


def find_box_sam(bbox, name):

    try:

        load_image_embedding(
            f"/home/mateo/pyronear/vision/dataset/annotator/pyro-annotator/annotations/embeddings/{name}.pth",
        )

        masks, _, _ = sam_predictor.predict(
            point_coords=None,
            point_labels=None,
            box=bbox[None, :],
            multimask_output=False,
        )

        Y, X = np.where(masks[0])
        Y, X = Y.astype("float"), X.astype("float")
        x_min, x_max = np.min(X), np.max(X)
        y_min, y_max = np.min(Y), np.max(Y)

        return [x_min, y_min, x_max, y_max]
    except:
        print("error with ", name, bbox)
        return [None, None, None, None]


def refresh_figure_shapes(figure, bboxs):
    """Set shapes in the given figure dict from the provided bboxs

    Args:
        figure (Dict): Figure dict
        bboxs (Optional[List[Bbox]]): Bboxs
    """
    figure["layout"]["shapes"] = bboxs_to_shapes(bboxs)


def shape_to_bbox(shape):
    """Convert shape to bbox

    Args:
        shape (Dict): Shape

    Returns:
        Bbox: Bbox
    """
    x = [shape[c] for c in ["x0", "x1"]]
    y = [shape[c] for c in ["y0", "y1"]]
    xyxy = [min(x), min(y), max(x), max(y)]
    return xyxy


def bboxs_to_shapes(bboxs):
    """Convert bboxs to shapes

    Args:
        bboxs (Optional[List[Bbox]]): Bboxs

    Returns:
        List[Dict]: Shapes
    """
    if bboxs is None:
        return []
    return [bbox_to_shape(bbox) for bbox in bboxs]


def bbox_to_shape(bbox, is_highlighted=False):
    """Convert bbox to shape

    Args:
        bbox (List): Bbox

    Returns:
        Dict: Shape
    """

    line_color = "rgba(255,0,0,1)"

    fill_color = "rgba(0,0,0,0)"

    return {
        "editable": True,
        "visible": True,
        "showlegend": False,
        "legend": "legend",
        "legendgroup": "",
        "legendgrouptitle": {"text": ""},
        "legendrank": 1000,
        "label": {"text": "", "texttemplate": ""},
        "xref": "x",
        "yref": "y",
        "layer": "above",
        "opacity": 1,
        "line": {"color": line_color, "width": 1, "dash": "solid"},
        "fillcolor": fill_color,
        "fillrule": "evenodd",
        "type": "rect",
        "x0": bbox[0],
        "y0": bbox[1],
        "x1": bbox[2],
        "y1": bbox[3],
    }


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

    (a1, a2), (b1, b2) = np.split(box1, 2, 1), np.split(box2, 2, 1)
    inter = (
        (np.minimum(a2, b2[:, None, :]) - np.maximum(a1, b1[:, None, :]))
        .clip(0)
        .prod(2)
    )

    # IoU = inter / (area1 + area2 - inter)
    return inter / ((a2 - a1).prod(1) + (b2 - b1).prod(1)[:, None] - inter + eps)


# Function to determine which bboxes to keep based on overlaps
def filter_overlapping_bboxes(iou_matrix):
    n = iou_matrix.shape[0]
    to_remove = set()

    # Iterate through the lower triangle of the matrix
    for i in range(n):
        for j in range(i + 1, n):
            if iou_matrix[i, j] > 0:
                to_remove.add(
                    i
                )  # Keep the last one, remove the first one in any overlapping pair

    # Calculate the indices to keep
    to_keep = set(range(n)) - to_remove
    return sorted(list(to_keep))

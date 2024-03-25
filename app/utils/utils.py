import numpy as np
import torch


from segment_anything import SamPredictor, sam_model_registry

__all__ = [
    "xywh2xyxy",
    "load_image_embedding",
    "shape_to_bbox",
    "bboxs_to_shapes",
    "find_box_sam",
    "box_iou",
    "filter_overlapping_bboxes",
]

# Load Sam
sam_checkpoint = "data/sam_vit_h_4b8939.pth"
model_type = "vit_h"
device = "cpu"
sam = sam_model_registry[model_type](checkpoint=sam_checkpoint)
sam.to(device=device)
sam_predictor = SamPredictor(sam)


def xywh2xyxy(x: np.ndarray):
    y = np.copy(x)
    y[..., 0] = x[..., 0] - x[..., 2] / 2  # top left x
    y[..., 1] = x[..., 1] - x[..., 3] / 2  # top left y
    y[..., 2] = x[..., 0] + x[..., 2] / 2  # bottom right x
    y[..., 3] = x[..., 1] + x[..., 3] / 2  # bottom right y
    return y


def load_image_embedding(path):
    res = torch.load(path, sam_predictor.device)
    for k, v in res.items():
        setattr(sam_predictor, k, v)


def find_box_sam(bbox, name, image_size=(1280, 720)):

    w, h = image_size
    r = 720 / h
    w2 = int(r * w)
    h2 = 720

    bbox[::2] = np.clip(bbox[::2], 0, w2)
    bbox[1::2] = np.clip(bbox[1::2], 0, h2)

    bbox = bbox.astype("float")

    bbox[::2] *= 1 / r
    bbox[1::2] *= 1 / r

    bbox = bbox.astype("int")

    try:

        load_image_embedding(
            f"data/embeddings/{name}.pth",
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

        bbox = np.array([x_min, y_min, x_max, y_max])

        bbox[::2] = np.clip(bbox[::2], 0, w)
        bbox[1::2] = np.clip(bbox[1::2], 0, h)

        bbox[::2] *= r
        bbox[1::2] *= r

        return bbox.astype("int")

    except Exception as e:
        print(f"Error with {name}, {bbox}: {e}")
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


def bboxs_to_shapes(bboxs, legendrank=1000, line_color="rgba(255,0,0,1)"):
    """Convert bboxs to shapes

    Args:
        bboxs (Optional[List[Bbox]]): Bboxs

    Returns:
        List[Dict]: Shapes
    """
    if bboxs is None:
        return []
    return [bbox_to_shape(bbox, legendrank, line_color) for bbox in bboxs]


def bbox_to_shape(bbox, legendrank, line_color):
    """Convert bbox to shape

    Args:
        bbox (List): Bbox

    Returns:
        Dict: Shape
    """

    fill_color = "rgba(0,0,0,0)"

    return {
        "editable": True,
        "visible": True,
        "showlegend": False,
        "legend": "legend",
        "legendgroup": "",
        "legendgrouptitle": {"text": ""},
        "legendrank": legendrank,
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

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
        print("error with ", name)
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
    xyxy = [shape[c] for c in ["x0", "y0", "x1", "y1"]]
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

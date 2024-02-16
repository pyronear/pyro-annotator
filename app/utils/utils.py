class Bbox:

    def __init__(self, xyxy, is_highlighted=False) -> None:

        self.xyxy = xyxy
        self.is_highlighted = is_highlighted

    def __repr__(self):
        return f"Bbox(xyxy={[int(x) for x in self.xyxy]}"

    def __eq__(self, other):
        if not isinstance(other, Bbox):
            return False
        return self.xyxy == other.xyxy


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
    return Bbox(xyxy)


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


def bbox_to_shape(bbox):
    """Convert bbox to shape

    Args:
        bbox (Bbox): Bbox

    Returns:
        Dict: Shape
    """

    rgb = (255, 0, 0)

    line_color = "rgba(%d,%d,%d,1)" % rgb

    # Fill color
    if bbox.is_highlighted:
        fill_color = "rgba(%d,%d,%d,0.45)" % rgb
    else:
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
        "line": {"color": line_color, "width": 4, "dash": "solid"},
        "fillcolor": fill_color,
        "fillrule": "evenodd",
        "type": "rect",
        "x0": bbox.xyxy[0],
        "y0": bbox.xyxy[1],
        "x1": bbox.xyxy[2],
        "y1": bbox.xyxy[3],
    }

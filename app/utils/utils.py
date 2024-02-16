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

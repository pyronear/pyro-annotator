import dash
from dash import html
from dash.dependencies import ALL, Input, Output, State
import glob
import random
from app_instance import app
import plotly.express as px
from PIL import Image
from dash.exceptions import PreventUpdate
from utils.utils import (
    shape_to_bbox,
    bboxs_to_shapes,
    find_box_sam,
    box_iou,
    filter_overlapping_bboxes,
)
from dash import callback_context
import shutil
import dash_bootstrap_components as dbc
import json
import os
import numpy as np

# from flask_caching import Cache


# # Configure Flask Caching
# cache = Cache(
#     app.server,
#     config={
#         "CACHE_TYPE": "filesystem",
#         "CACHE_DIR": "cache-directory",
#     },
# )


@app.callback(
    [
        Output("images_files", "data"),
        Output("model_prediction_dict", "data"),
        Output("fire_progress", "children"),
    ],
    [Input("skip_btn", "n_clicks"), Input("done_btn", "n_clicks")],
    [State("images_files", "data"), State("bbox_dict", "data")],
)
def load_fire(n_clicks_skip, n_clicks_done, images_files, bbox_dict):
    # Determine which button was clicked last
    ctx = callback_context
    if not ctx.triggered:
        button_id = "No clicks yet"
    else:
        button_id = ctx.triggered[0]["prop_id"].split(".")[0]

    if len(images_files):

        fire = os.path.dirname(images_files[0])
        print(fire)

        # Based on the button clicked, perform the action
        if button_id == "done_btn":

            shutil.move(fire, fire.replace("to_do", "done"))
            label_file = fire.replace("to_do", "labels/done") + ".json"
            os.makedirs(os.path.dirname(label_file), exist_ok=True)
            with open(label_file, "w") as file:
                json.dump(bbox_dict, file)
        elif button_id == "skip_btn":

            shutil.move(fire, fire.replace("to_do", "skip"))
            label_file = fire.replace("to_do", "labels/skip") + ".json"
            os.makedirs(os.path.dirname(label_file), exist_ok=True)

            with open(label_file, "w") as file:
                json.dump(bbox_dict, file)

    # Common logic to load images (can adjust based on button clicked if needed)
    fires = glob.glob("data/to_do/*")
    fire = random.choice(fires)
    images_files = glob.glob(f"{fire}/*.jpg")
    images_files.sort()

    name = fire.split("/")[-1]

    label_file = f"data/auto_labels/{name}.json"

    model_prediction_dict = {}
    if os.path.isfile(label_file):
        with open(label_file, "r") as file:
            model_prediction_dict = json.load(file)

    return images_files, model_prediction_dict, f"Fires to do: {len(fires)}"


@app.callback(
    Output("image_idx", "data"),
    [
        Input("next_btn", "n_clicks"),
        Input("prev_btn", "n_clicks"),
        Input("images_files", "data"),
    ],
    State("image_idx", "data"),
)
def change_image_idx(n_clicks_next, n_clicks_prev, images_files, current_index):
    # Initialize the current index if it's None

    if current_index is None:
        current_index = 0

    if images_files is None:
        raise PreventUpdate

    # Initialize click counts if they're None
    n_clicks_next = n_clicks_next or 0
    n_clicks_prev = n_clicks_prev or 0

    # Determine which button was clicked last based on the n_clicks values
    changed_id = [p["prop_id"] for p in dash.callback_context.triggered][0]
    if "next_btn" in changed_id:
        # Move to the next image, wrap if at the end
        current_index = min(current_index + 1, len(images_files))
    elif "prev_btn" in changed_id:
        # Move to the previous image, wrap if at the beginning
        current_index = max(current_index - 1, 0)

    elif "images_files" in changed_id:
        current_index = 0

    return current_index


@app.callback(
    Output("image_progress", "children"),
    Input("image_idx", "data"),
    State("images_files", "data"),
)
def update_text(image_idx, images_files):
    return f"Image: {image_idx}/{len(images_files)-1}"


@app.callback(
    [
        Output("graph", "figure"),
        Output("trigger_update_bbox_dict", "data"),
        Output("bbox_deleted", "data"),
    ],
    [
        Input("image_idx", "data"),
        Input({"type": "bbox_highlight_button", "index": ALL}, "n_clicks"),
        Input({"type": "bbox_delete_button", "index": ALL}, "n_clicks"),
        Input("fit_btn", "n_clicks"),
    ],
    [
        State("images_files", "data"),
        State("bbox_dict", "data"),
        State("model_prediction_dict", "data"),
        State("bbox_deleted", "data"),
        State("graph", "figure"),
    ],
)
def update_figure(
    image_idx,
    bbox_highlight_clicks,
    bbox_delete_clicks,
    fit_btn_cliks,
    images_files,
    bbox_dict,
    model_prediction_dict,
    bbox_deleted,
    current_figure,
):
    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]["prop_id"]

    if image_idx < len(images_files):
        images_file = images_files[image_idx]
    else:
        images_file = None
    # Check the action to perform based on the button clicked
    if images_file and (
        "bbox_highlight_button" in triggered_id or "bbox_delete_button" in triggered_id
    ):

        # If the callback was not triggered by image_idx, it must be one of the buttons
        if not current_figure or not bbox_dict:
            raise PreventUpdate

        button_clicks = ctx.triggered[0]["value"]
        if button_clicks is None or button_clicks == 0:
            raise PreventUpdate  # Prevent update if the button wasn't actually clicked (no clicks)

        # Determine which button was clicked and its action
        btn_dict = json.loads(triggered_id.split(".")[0])
        btn_type = btn_dict["type"]
        btn_index = btn_dict["index"]

        if btn_type == "bbox_delete_button":
            # Deleting BBox
            if 0 <= btn_index < len(bbox_dict[images_files[image_idx]]):
                box = bbox_dict[images_files[image_idx]].pop(btn_index)
                # print("box_to_delete", box)
                if images_file not in bbox_deleted.keys():
                    bbox_deleted[images_file] = []
                bbox_deleted[images_file].append(box)

        # Update the shapes based on bbox_dict
        updated_bboxs = bbox_dict[images_files[image_idx]]
        current_figure["layout"]["shapes"] = bboxs_to_shapes(updated_bboxs)

        # Update the shapes based on bbox_dict
        updated_bboxs = bbox_dict[images_files[image_idx]]
        current_figure["layout"]["shapes"] = bboxs_to_shapes(updated_bboxs)

        # Check the action to perform based on the button clicked
        if btn_type == "bbox_highlight_button":

            # Highlighting BBox
            if 0 <= btn_index < len(updated_bboxs):
                for shape in current_figure["layout"]["shapes"]:
                    shape["fillcolor"] = "rgba(0,0,0,0)"  # reset other shapes

                print(shape["fillcolor"], button_clicks)
                if button_clicks % 2 == 1:
                    current_figure["layout"]["shapes"][btn_index][
                        "fillcolor"
                    ] = "rgba(255,0,0,0.45)"

                print(shape["fillcolor"])

        return current_figure, len(updated_bboxs), bbox_deleted

    if images_file and "fit_btn" in triggered_id:

        fitted_bbox = []

        bbox_list = bbox_dict[images_file]
        for bbox in bbox_list:

            bbox_array = np.array(bbox).reshape((-1, 4)).astype("int")

            name = os.path.basename(images_file).split(".")[0]

            [x_min, y_min, x_max, y_max] = find_box_sam(bbox_array, name)

            if x_min is not None:
                fitted_bbox.append([x_min, y_min, x_max, y_max])
            else:
                fitted_bbox.append(bbox)

        bbox_dict[images_file] = fitted_bbox

    if images_files is None or image_idx is None:
        raise PreventUpdate

    # Check if all images have been annotated
    if images_files and image_idx >= len(images_files):
        # Display completion message instead of an image
        fig = {
            "layout": {
                "xaxis": {"visible": False},
                "yaxis": {"visible": False},
                "annotations": [
                    {
                        "text": "Annotation task is done",
                        "xref": "paper",
                        "yref": "paper",
                        "showarrow": False,
                        "font": {"size": 20},
                    }
                ],
            }
        }
        return fig, 0, bbox_deleted
    else:
        # Load the image and create the figure
        image = Image.open(images_files[image_idx])
        fig = px.imshow(image)
        line_color = "rgba(255,0,0,1)"
        line_width = 1
        fig.update_layout(
            dragmode="drawrect",
            newshape=dict(line_color=line_color, line_width=line_width),
            margin=dict(l=0, r=0, t=0, b=0),
            autosize=True,
            template=None,
        )

    # Update the shapes based on bbox_dict
    if images_files[image_idx] in bbox_dict:
        bboxs = bbox_dict[images_files[image_idx]]
        fig["layout"]["shapes"] = bboxs_to_shapes(bboxs)

    if images_file in model_prediction_dict.keys():
        bboxs = model_prediction_dict[images_file]
        if fig["layout"]["shapes"]:
            fig["layout"]["shapes"] = list(fig["layout"]["shapes"]) + bboxs_to_shapes(
                bboxs, legendrank=999, line_color="rgba(255,0,255,1)"
            )
        else:
            fig["layout"]["shapes"] = bboxs_to_shapes(
                bboxs, legendrank=999, line_color="rgba(255,0,255,1)"
            )

    for trace in fig.data:
        trace.update(hoverinfo="none", hovertemplate=None)
    return fig, 0, bbox_deleted


# @cache.memoize(timeout=50)  # Cache the result for 50 seconds
@app.callback(
    Output("bbox_dict", "data"),
    [
        Input("graph", "relayoutData"),
        Input("trigger_update_bbox_dict", "data"),
        Input("propagate_btn", "n_clicks"),
    ],
    [
        State("image_idx", "data"),
        State("images_files", "data"),
        State("bbox_dict", "data"),
        State("graph", "figure"),
        State("bbox_deleted", "data"),
    ],
)
def update_bbox_dict(
    relayoutData,
    trigger_update_bbox_dict,
    propagate_btn_cliks,
    image_idx,
    images_files,
    bbox_dict,
    figure,
    bbox_deleted,
):

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]["prop_id"]
    if image_idx >= len(images_files):
        raise PreventUpdate

    # Get the current image file path
    images_file = images_files[image_idx]

    if "propagate_btn" in triggered_id:
        print("propagation ...")

        # propagate deleted boxes
        if images_file in bbox_deleted.keys():

            curr_bbox_deleted = bbox_deleted[images_file]
            curr_bbox_deleted_np = (
                np.array(curr_bbox_deleted).reshape((-1, 4)).astype("int")
            )

            idx = images_files.index(images_file)

            for image_name in images_files[idx + 1 :]:

                if image_name in bbox_dict.keys():
                    new_boxes = []
                    for box in bbox_dict[image_name]:
                        np_box = np.array(box).reshape((-1, 4)).astype("int")
                        iou = box_iou(np_box, curr_bbox_deleted_np)

                        if np.max(iou) == 0:
                            new_boxes.append(box)

                    bbox_dict[image_name] = new_boxes

        else:
            curr_bbox_deleted = []

        # propagate new boxes
        coeff = 0.05
        if images_file in bbox_dict.keys():

            for current_box in bbox_dict[images_file]:
                bbox = np.array(current_box).reshape((-1, 4)).astype("int")

                idx = images_files.index(images_file)
                for image_name in images_files[idx + 1 :]:

                    name = os.path.basename(image_name).split(".")[0]
                    [x_min, y_min, x_max, y_max] = bbox[0]
                    dx = (x_max - x_min) * coeff
                    dy = (y_max - y_min) * coeff
                    bbox = (
                        np.array((x_min - dx, y_min - dy, x_max + dx, y_max + dy))
                        .reshape((-1, 4))
                        .astype("int")
                    )

                    [x_min, y_min, x_max, y_max] = find_box_sam(bbox, name)

                    if x_min is not None:
                        bbox = (
                            np.array((x_min, y_min, x_max, y_max))
                            .reshape((-1, 4))
                            .astype("int")
                        )

                        if image_name not in bbox_dict.keys():
                            bbox_dict[image_name] = []

                        bbox_dict[image_name].append([x_min, y_min, x_max, y_max])

            # Drop duplicate
            if image_name in bbox_dict.keys():
                bboxes = np.array(bbox_dict[image_name]).reshape((-1, 4)).astype("int")
                iou_matrix = box_iou(bboxes, bboxes)
                index = filter_overlapping_bboxes(iou_matrix)

                bbox_dict[image_name] = [bbox_dict[image_name][i] for i in index]

        print("propagation done")

        return bbox_dict

    if "trigger_update_bbox_dict" in triggered_id:

        relayoutData = figure["layout"]
    # If relayoutData is None or doesn't contain shapes, do nothing
    if relayoutData is None or "shapes" not in relayoutData:
        raise PreventUpdate

    # Ensure this image file is in the bbox_dict
    if images_file not in bbox_dict:
        bbox_dict[images_file] = []

    # Convert shapes in relayoutData to bbox format
    relayout_bboxes = [
        shape_to_bbox(shape)
        for shape in relayoutData["shapes"]
        if shape["legendrank"] == 1000
    ]

    # Update bbox_dict only with the bboxes that exist in relayoutData
    bbox_dict[images_file] = relayout_bboxes

    return bbox_dict


# @cache.memoize(timeout=50)  # Cache the result for 50 seconds
@app.callback(
    Output("bbox_list", "children"),
    [Input("bbox_dict", "data")],
    [
        State("image_idx", "data"),
        State("images_files", "data"),
    ],
)
def update_bbox_list(bbox_dict, image_idx, images_files):
    if not bbox_dict:
        raise PreventUpdate

    images_file = images_files[image_idx]

    bboxs = bbox_dict[images_file]

    # Initialize an empty list to hold button pairs with labels
    buttons_with_labels = []
    for bbox_id in range(len(bboxs)):
        # Label for the bounding box
        bbox_label = html.Div(
            f"{bbox_id} ", className="mb-1"
        )  # Adjust the class as needed for styling

        # Highlight button
        highlight_button = dbc.Button(
            "H",
            id={"type": "bbox_highlight_button", "index": bbox_id},
            className="mb-2",  # Margin at the bottom
            color="primary",
            style={
                "width": "40px"
            },  # Ensure width is sufficient to make buttons square
        )

        # Delete button
        delete_button = dbc.Button(
            "D",
            id={"type": "bbox_delete_button", "index": bbox_id},
            className="mb-2",
            color="danger",
            style={
                "width": "40px"
            },  # Ensure width is sufficient to make buttons square
        )

        # Flex container for each pair of buttons and the label
        button_pair_with_label = html.Div(
            [
                dbc.Col(
                    bbox_label,
                    width=2,
                    className="d-flex justify-content-end align-items-center",
                ),  # Adjust width as needed
                dbc.Col(
                    highlight_button, width="auto", className="me-1"
                ),  # Margin to the right for space
                dbc.Col(delete_button, width="auto"),
            ],
            className="d-flex align-items-center mb-2",  # Flex container with vertical alignment and margin at the bottom
        )

        buttons_with_labels.append(button_pair_with_label)

    return html.Div(
        buttons_with_labels
    )  # Wrap the list of buttons with labels in a Div for the entire group

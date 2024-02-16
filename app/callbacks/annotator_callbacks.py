import dash
from dash import html, dcc
from dash.dependencies import ALL, Input, Output, State
import glob
import random
from app_instance import app
import plotly.express as px
from PIL import Image
from dash.exceptions import PreventUpdate
from utils.utils import shape_to_bbox, bboxs_to_shapes
from dash import callback_context
import shutil
import dash_bootstrap_components as dbc
import json


@app.callback(
    [Output("images_files", "data"), Output("fire_progress", "children")],
    [Input("skip_btn", "n_clicks"), Input("done_btn", "n_clicks")],
    State("images_files", "data"),
)
def load_fire(n_clicks_skip, n_clicks_done, images_files):
    # Determine which button was clicked last
    ctx = callback_context
    if not ctx.triggered:
        button_id = "No clicks yet"
    else:
        button_id = ctx.triggered[0]["prop_id"].split(".")[0]

    if len(images_files):

        fire = images_files[0].split("/images")[0]

        # Based on the button clicked, perform the action
        if button_id == "done_btn":
            print("Clicked done")
            shutil.move(fire, fire.replace("to_do", "done"))
        elif button_id == "skip_btn":
            print("Clicked skip")
            shutil.move(fire, fire.replace("to_do", "skip"))

    # Common logic to load images (can adjust based on button clicked if needed)
    fires = glob.glob("Data/to_do/*")
    fire = random.choice(fires)
    images_files = glob.glob(f"{fire}/images/*")
    images_files.sort()

    return images_files, f"Fires to do: {len(fires)}"


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
        current_index = (current_index + 1) % len(images_files)
    elif "prev_btn" in changed_id:
        # Move to the previous image, wrap if at the beginning
        current_index = (current_index - 1) % len(images_files)
        if current_index < 0:
            current_index = len(images_files) - 1

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
    [Output("graph", "figure"), Output("trigger_update_bbox_dict", "data")],
    [
        Input("image_idx", "data"),
        Input({"type": "bbox_highlight_button", "index": ALL}, "n_clicks"),
        Input({"type": "bbox_delete_button", "index": ALL}, "n_clicks"),
    ],
    [
        State("images_files", "data"),
        State("bbox_dict", "data"),
        State("graph", "figure"),
    ],
)
def update_figure(
    image_idx,
    bbox_highlight_clicks,
    bbox_delete_clicks,
    images_files,
    bbox_dict,
    current_figure,
):
    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]["prop_id"]

    if "image_idx" in triggered_id:
        if images_files is None or image_idx is None:
            raise PreventUpdate

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

        for trace in fig.data:
            trace.update(hoverinfo="none", hovertemplate=None)
        return fig, 0
    else:
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
                bbox_dict[images_files[image_idx]].pop(btn_index)

        # Update the shapes based on bbox_dict
        updated_bboxs = bbox_dict[images_files[image_idx]]
        current_figure["layout"]["shapes"] = bboxs_to_shapes(updated_bboxs)

        # Check the action to perform based on the button clicked
        if btn_type == "bbox_highlight_button":
            print("highlight")
            # Highlighting BBox
            if 0 <= btn_index < len(updated_bboxs):
                for shape in current_figure["layout"]["shapes"]:
                    shape["fillcolor"] = "rgba(0,0,0,0)"  # reset other shapes
                if button_clicks % 2 == 1:
                    current_figure["layout"]["shapes"][btn_index][
                        "fillcolor"
                    ] = "rgba(255,0,0,0.45)"

        print("layout", len(current_figure["layout"]["shapes"]))
        return current_figure, len(updated_bboxs)


@app.callback(
    Output("bbox_dict", "data"),
    [Input("graph", "relayoutData"), Input("trigger_update_bbox_dict", "data")],
    [
        State("image_idx", "data"),
        State("images_files", "data"),
        State("bbox_dict", "data"),
        State("graph", "figure"),
    ],
)
def update_bbox_dict(
    relayoutData, trigger_update_bbox_dict, image_idx, images_files, bbox_dict, figure
):

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]["prop_id"]

    if "trigger_update_bbox_dict" in triggered_id:
        print("triger trigger_update_bbox_dict")
        relayoutData = figure["layout"]
    # If relayoutData is None or doesn't contain shapes, do nothing
    if relayoutData is None or "shapes" not in relayoutData:
        raise PreventUpdate

    print("update dict", len(relayoutData["shapes"]), trigger_update_bbox_dict)

    # Get the current image file path
    images_file = images_files[image_idx]

    # Ensure this image file is in the bbox_dict
    if images_file not in bbox_dict:
        bbox_dict[images_file] = []

    # Convert shapes in relayoutData to bbox format
    relayout_bboxes = [shape_to_bbox(shape) for shape in relayoutData["shapes"]]

    # Update bbox_dict only with the bboxes that exist in relayoutData
    bbox_dict[images_file] = relayout_bboxes

    return bbox_dict


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

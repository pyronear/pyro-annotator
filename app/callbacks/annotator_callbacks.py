import dash
from dash import html, dcc
from dash.dependencies import ALL, Input, Output, State
import glob
import random
from app_instance import app
import plotly.express as px
from PIL import Image
from dash.exceptions import PreventUpdate

@app.callback(
    Output("images_files", "data"),
    [Input("skip_btn", "n_clicks"), Input("done_btn", "n_clicks")],
)
def load_fire(n_clicks_skip, n_clicks_done):
    print("cliked done")

    fires = glob.glob("Data/to_do/*")
    fire = random.choice(fires)
    images_files = glob.glob(f"{fire}/images/*")
    images_files.sort()

    return images_files


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

    print(n_clicks_next, n_clicks_prev, len(images_files), current_index)
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
    Output("graph", "figure"),
    Input("image_idx", "data"),
    State("images_files", "data"),
)
def update_figure(image_idx, images_files):
    print("update firgure", image_idx, len(images_files))

    if images_files is None or image_idx is None:
        raise PreventUpdate

    image = Image.open(images_files[image_idx])
   
    fig = px.imshow(image)
    line_color = "rgba(%d,%d,%d,1)" % (255, 0, 0)
    line_width = 1
    fig.update_layout(
        dragmode="drawrect",
        newshape=dict(line_color=line_color, line_width=line_width),
        margin=dict(l=0, r=0, t=0, b=0),  # Remove margins
        autosize=True,
        # Make the plot responsive to the window size
        template=None,  # Remove default Plotly styling
    )

    for trace in fig.data:
        trace.update(hoverinfo="none", hovertemplate=None)

    return fig



@app.callback(
    Output("bbox", "data"),
    [
        Input("graph", "relayoutData"),
    ],
 
)
def new_bbox(relayoutData):
    print(relayoutData)

    return {}
    


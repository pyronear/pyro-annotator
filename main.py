# Import dash_annotate_cv package
import dash_annotate_cv as dacv


# Other imports
from dash import Dash, html
import dash_bootstrap_components as dbc
import logging
import sys
import os
from datetime import datetime
import glob
from PIL import Image
from dash import callback_context
from dash.dependencies import Input, Output, State
from dash.exceptions import PreventUpdate


# Set up logging
root = logging.getLogger()
root.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
root.addHandler(handler)

imgs = glob.glob("annotations/images/*")
imgs.sort()
len(imgs)

t0 = datetime.now()
fires = {}
current_fire = []
for file in imgs:
    t = os.path.basename(file).split(".")[0].split("2023")[1]
    t = datetime.strptime("2023" + t, "%Y_%m_%dT%H_%M_%S")

    if abs((t - t0).total_seconds()) < 30 * 60:  # 30mn
        current_fire.append(file)
    else:
        if len(current_fire):
            fires[len(fires)] = current_fire
            current_fire = []
        else:
            current_fire.append(file)

    t0 = t


images_files = fires[0]


if __name__ == "__main__":
    # Load some images

    images_pil = [(os.path.basename(file), Image.open(file)) for file in images_files]

    # Set up the image and label sources
    image_source = dacv.ImageSource(images=images_pil)
    label_source = dacv.LabelSource(labels=["face", "eye", "body"])

    # Set up writing
    storage = dacv.AnnotationStorage(
        storage_types=[
            dacv.StorageType.JSON,  # Default storage type
        ],
        json_file="example_bboxs.default.json",
    )
    annotations_existing = dacv.load_image_anns_from_storage(storage)

    aio = dacv.AnnotateImageBboxsAIO(
        label_source=label_source,
        image_source=image_source,
        annotation_storage=storage,
        annotations_existing=annotations_existing,
        options=dacv.AnnotateImageOptions(),
    )

    print("aiiiiiiiiiiiiiiiiiio", type(aio))
    app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

    app.layout = html.Div(
        [
            # Row for the aio component
            dbc.Row(
                [
                    dbc.Col(html.Div(id="aio_container", children=aio), md=12),
                ]
            ),
            # Hidden Div for storing state
            html.Div(id="dummy-output"),
        ],
        style={"width": "100%", "display": "inline-block"},
    )
    app.run(debug=True)

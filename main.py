# Import dash_annotate_cv package
import dash_annotate_cv as dacv


# Other imports
from dash import Dash, html
import dash_bootstrap_components as dbc
import logging
import sys
import os


from PIL import Image

from dash.dependencies import Input, Output


# Set up logging
root = logging.getLogger()
root.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
root.addHandler(handler)


if __name__ == "__main__":
    # Load some images

    images_pil = [(os.path.basename(file), Image.open(file)) for file in images_files]

    # Set up the image and label sources
    image_source = dacv.ImageSource(images=images_pil)
    label_source = dacv.LabelSource(labels=["smoke"])

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

    app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

    app.layout = html.Div(
        [
            # Row for the aio componenth
            dbc.Row(
                [
                    dbc.Col(
                        html.Button(id="hidden-button-prev", style={"display": "none"})
                    ),
                    dbc.Col(
                        html.Button(id="hidden-button-next", style={"display": "none"})
                    ),
                    dbc.Col(
                        html.Button(id="hidden-button-fit", style={"display": "none"})
                    ),
                    dbc.Col(
                        html.Button(
                            id="hidden-button-propagate", style={"display": "none"}
                        )
                    ),
                    dbc.Col(html.Div(id="aio_container", children=aio), md=12),
                ]
            ),
            html.Div(id="prev-div"),
            html.Div(id="next-div"),
            html.Div(id="fit-div"),
            html.Div(id="propagate-div"),
            html.Div(id="output-div"),
        ],
        style={"width": "100%", "display": "inline-block"},
    )

    app.clientside_callback(
        """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyQ') { 
                    document.getElementById('hidden-button-prev').click();
                }
            });
            return "";
        }
        """,
        Output("prev-div", "children"),
        Input("hidden-button-prev", "n_clicks"),
    )
    app.clientside_callback(
        """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyW') { 
                    document.getElementById('hidden-button-next').click();
                }
            });
            return "";
        }
        """,
        Output("next-div", "children"),
        Input("hidden-button-next", "n_clicks"),
    )

    app.clientside_callback(
        """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyE') { 
                    document.getElementById('hidden-button-fit').click();
                }
            });
            return "";
        }
        """,
        Output("fit-div", "children"),
        Input("hidden-button-fit", "n_clicks"),
    )

    app.clientside_callback(
        """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyR') { 
                    document.getElementById('hidden-button-propagate').click();
                }
            });
            return "";
        }
        """,
        Output("propagate-div", "children"),
        Input("hidden-button-propagate", "n_clicks"),
    )

    app.run(debug=True)

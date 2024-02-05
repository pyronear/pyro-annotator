# Import dash_annotate_cv package
import dash_annotate_cv as dacv


# Other imports
import dash
from dash import Dash, html, dcc
import dash_bootstrap_components as dbc
import logging
import sys
import os
import glob
import random
from PIL import Image
from dash.exceptions import PreventUpdate
from dash.dependencies import Input, Output, State
from datetime import datetime

# Set up logging
root = logging.getLogger()
root.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
root.addHandler(handler)


if __name__ == "__main__":

    app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])
    server = app.server

    app.layout = html.Div(
        [
            dcc.Store(id="aio-visibility", data={"visible": True}),
            dbc.Row(
                dbc.Col(
                    html.Button("Recreate AIO", id="recreate-aio-button"),
                    width=12,
                    className="mb-3",
                )
            ),
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
                    dbc.Col(
                        html.Div(
                            id="aio_container",
                            children=dacv.AnnotateImageBboxsAIO(),
                            style={"display": "block"},  # Default to visible
                        ),
                        md=12,
                    ),
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

    # Callback to toggle visibility state
    @app.callback(
        Output("aio-visibility", "data"),
        Input("recreate-aio-button", "n_clicks"),
        State("aio-visibility", "data"),
    )
    def toggle_visibility(n_clicks, visibility_data):
        if n_clicks is None or n_clicks == 0:
            raise PreventUpdate

        # Toggle the visibility
        new_visibility = not visibility_data["visible"]
        return {"visible": new_visibility}

    # Callback to recreate the AIO component based on visibility toggle
    @app.callback(Output("aio_container", "children"), Input("aio-visibility", "data"))
    def recreate_aio(visibility_data):
        if visibility_data["visible"]:
            # Recreate the AIO component when visibility is toggled back to True
            new_aio = dacv.AnnotateImageBboxsAIO()
            return new_aio
        else:
            # Optionally, manage the invisible state
            raise PreventUpdate

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

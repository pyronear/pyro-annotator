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
from dash.dependencies import Input, Output
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
            dcc.Store(id="trigger"),
            dbc.Row(
                [
                    dbc.Col(html.Button("Reload App", id="reload-button"), md=12),
                ]
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
                            id="aio_container", children=dacv.AnnotateImageBboxsAIO()
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

    app.clientside_callback(
        """
        function(n_clicks) {
            if(n_clicks > 0) {
                window.location.reload();
            }
        }
        """,
        output=dash.dependencies.Output("dummy-div", "children"),  # Dummy output
        inputs=[dash.dependencies.Input("reload-button", "n_clicks")],
    )

    # Add a dummy div to the layout that serves as the target for the clientside callback's output
    app.layout.children.append(html.Div(id="dummy-div", style={"display": "none"}))

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

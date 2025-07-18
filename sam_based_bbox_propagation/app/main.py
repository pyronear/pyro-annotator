# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.


import callbacks.annotator_callbacks  # noqa: F401
from app_instance import app
from dash import html
from dash.dependencies import Input, Output
from layouts.main_layout import get_main_layout
from pages.homapage import homepage_layout

# Set the app layout
app.layout = get_main_layout()


# Manage Pages
@app.callback(
    Output("page-content", "children"),
    Input("url", "pathname"),
)
def display_page(pathname):
    if pathname == "/" or pathname is None:
        return homepage_layout()
    return html.Div([html.P("Unable to find this page.", className="alert alert-warning")])


# ----------------------------------------------------------------------------------------------------------------------
# RUNNING THE WEB-APP SERVER

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Pyronear web-app",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host of the server")
    parser.add_argument("--port", type=int, default=8050, help="Port to run the server on")
    args = parser.parse_args()

    app.run_server(host=args.host, port=args.port, debug=True)

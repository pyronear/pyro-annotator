# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.


from dash import dcc, html
from components.navbar import Navbar


def get_main_layout():
    return html.Div(
        [
            dcc.Location(id="url", refresh=False),
            html.Div(
                [
                    Navbar(),  # This includes the navbar at the top of the page
                    html.Div(id="page-content"),
                ]
            ),
            dcc.Store(id="images_files", data=[]),
            dcc.Store(id="image_idx", data=0),
            dcc.Store(id="bbox_dict", data={}),
            dcc.Store(id="bbox_deleted", data={}),
            dcc.Store(id="trigger_update_bbox_dict", data=0),
            html.Div(id="hidden-div"),
        ]
    )

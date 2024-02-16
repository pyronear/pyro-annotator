# Copyright (C) 2020-2024, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

import dash_bootstrap_components as dbc
from dash import dcc, html


def homepage_layout():
    # Define buttons
    skip_button = dbc.Button(
        "Skip (S)",
        id="skip_btn",
        style={
            "backgroundColor": "#FD5252",
            "width": "100%",
            "border": "none",
        },
    )
    done_button = dbc.Button(
        "Done (D)",
        id="done_btn",
        style={
            "backgroundColor": "#F28C28",
            "width": "100%",
            "border": "none",
        },
    )
    prev_button = dbc.Button(
        "Prev (A)",
        id="prev_btn",
        style={
            "backgroundColor": "#FEBA6A",
            "width": "100%",
            "border": "none",
        },
    )
    next_button = dbc.Button(
        "Next (Z)",
        id="next_btn",
        style={
            "backgroundColor": "#2C796E",
            "width": "100%",
            "border": "none",
        },
    )
    fit_button = dbc.Button(
        "Fit (E)",
        id="fit_btn",
        style={
            "backgroundColor": "#054546",
            "width": "100%",
            "border": "none",
        },
    )
    propagate_button = dbc.Button(
        "Propagate (R)",
        id="propagate_btn",
        style={
            "backgroundColor": "#FD5252",  # Consider choosing another color if you prefer distinct colors for all.
            "width": "100%",
            "border": "none",
        },
    )

    # Buttons container
    buttons_container = dbc.Row(
        [
            dbc.Col(skip_button, width=2),
            dbc.Col(done_button, width=2),
            dbc.Col(prev_button, width=2),
            dbc.Col(next_button, width=2),
            dbc.Col(fit_button, width=2),
            dbc.Col(propagate_button, width=2),
        ],
        className="mb-2",  # Add margin bottom
        style={"margin-top": "5px"},
        justify="center",  # Center the buttons row if needed or use "start" to align them to the left
    )

    # Return updated container with buttons and existing layout
    return dbc.Container(
        [
            buttons_container,  # Insert buttons container at the top
            dbc.Row(
                [
                    dbc.Col(
                        [
                            dcc.Graph(
                                id="graph",
                                style={"height": "calc(100vh - 120px)"},
                            )
                        ],
                        md=11,
                    ),
                    dbc.Col(
                        [
                            html.Div(id="fire_progress", children=""),
                            html.Div(id="image_progress", children=""),
                            html.Div(id="bbox_list"),  # Empty container
                        ],
                        md=1,
                    ),
                ]
            ),
        ],
        fluid=True,
    )

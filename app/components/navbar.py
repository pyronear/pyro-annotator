import dash_bootstrap_components as dbc
from dash import html

pyro_logo = "https://pyronear.org/img/logo_letters_orange.png"


def Navbar():
    navbar = dbc.Navbar(
        [
            dbc.Row(
                [
                    dbc.Col(html.Img(src=pyro_logo, height="30px")),
                ],
                align="center",
                className="ml-auto flex-nowrap mt-3 mt-md-0",  # Adjust margins as needed
            ),
            dbc.NavbarToggler(id="navbar-toggler"),
            dbc.Collapse(
                dbc.Row(
                    [
                        dbc.Col(
                            dbc.Input(
                                id="propagation_width_growth",
                                type="number",
                                value=2,  # Default value
                                placeholder="Width Growth (%)",
                                className="mr-2",  # Margin right for spacing
                                style={"maxWidth": 150},  # Adjust width as needed
                            ),
                            width="auto",
                        ),
                        dbc.Col(
                            dbc.Input(
                                id="propagation_height_growth",
                                type="number",
                                value=2,  # Default value
                                placeholder="Height Growth (%)",
                                className="mr-2",  # Margin right for spacing
                                style={"maxWidth": 150},  # Adjust width as needed
                            ),
                            width="auto",
                        ),
                    ],
                    className="ml-auto flex-nowrap mt-3 mt-md-0",
                    align="center",
                ),
                id="navbar-collapse",
                navbar=True,
            ),
        ],
        id="main_navbar",
        color="#044448",
        dark=True,
    )

    return navbar

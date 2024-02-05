import dash_bootstrap_components as dbc
from dash import html

pyro_logo = "https://pyronear.org/img/logo_letters_orange.png"


def Navbar():

    navbar = dbc.Navbar(
        [
            dbc.Row(
                [
                    dbc.Col(html.Img(src=pyro_logo, height="30px"), width=10),
                ],
                align="center",
            ),
            dbc.NavbarToggler(id="navbar-toggler"),
        ],
        id="main_navbar",
        color="#044448",
        dark=True,
    )

    return navbar

import dash
import dash_bootstrap_components as dbc

# Create the Dash app instance
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.UNITED])
app.config.suppress_callback_exceptions = True
server = app.server

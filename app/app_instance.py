import dash
import dash_bootstrap_components as dbc
from dash.dependencies import Input, Output

# Create the Dash app instance
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.UNITED])
app.config.suppress_callback_exceptions = True


app.clientside_callback(
    """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyQ') { 
                    document.getElementById('prev_btn').click();
                }
            });
            return "";
        }
        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("prev_btn", "n_clicks"),
    prevent_initial_call=True,
)
app.clientside_callback(
    """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyW') { 
                    document.getElementById('next_btn').click();
                }
            });
            return "";
        }
        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("next_btn", "n_clicks"),
    prevent_initial_call=True,
)

app.clientside_callback(
    """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyE') { 
                    document.getElementById('fit_btn').click();
                }
            });
            return "";
        }
        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("fit_btn", "n_clicks"),
    prevent_initial_call=True,
)

app.clientside_callback(
    """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyR') { 
                    document.getElementById('propagate_btn').click();
                }
            });
            return "";
        }
        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("propagate_btn", "n_clicks"),
    prevent_initial_call=True,
)

app.clientside_callback(
    """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyA') { 
                    document.getElementById('skip_btn').click();
                }
            });
            return "";
        }
        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("skip_btn", "n_clicks"),
    prevent_initial_call=True,
)

app.clientside_callback(
    """
        function(n_clicks) {
            document.addEventListener('keydown', function(event) {
                if (event.code === 'KeyS') {  
                    document.getElementById('done_btn').click();
                }
            });
            return "";
        }
        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("done_btn", "n_clicks"),
    prevent_initial_call=True,
)

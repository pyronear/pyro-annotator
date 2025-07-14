import dash
import dash_bootstrap_components as dbc
from dash.dependencies import Input, Output

# Create the Dash app instance
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.UNITED])
app.config.suppress_callback_exceptions = True


app.clientside_callback(
    """
        function(n_clicks) {
            if (typeof window.addedKeyListeners === 'undefined') {
                window.addedKeyListeners = {}; // Initialize an object to track added listeners
            }

            if (!window.addedKeyListeners['KeyQ']) { // Check if the listener for 'KeyQ' has been added
                document.addEventListener('keydown', function(event) {
                    if (event.code === 'KeyQ') {
                        document.getElementById('prev_btn').click();
                    }
                });
                window.addedKeyListeners['KeyQ'] = true; // Mark 'KeyQ' listener as added
            }
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
            if (typeof window.addedKeyListeners === 'undefined') {
                window.addedKeyListeners = {}; // Initialize an object to track added listeners
            }

            if (!window.addedKeyListeners['KeyW']) { 
                document.addEventListener('keydown', function(event) {
                    if (event.code === 'KeyW') {
                        document.getElementById('next_btn').click();
                    }
                });
                window.addedKeyListeners['KeyW'] = true; 
            }
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
            if (typeof window.addedKeyListeners === 'undefined') {
                window.addedKeyListeners = {}; // Initialize an object to track added listeners
            }

            if (!window.addedKeyListeners['KeyE']) { 
                document.addEventListener('keydown', function(event) {
                    if (event.code === 'KeyE') {
                        document.getElementById('fit_btn').click();
                    }
                });
                window.addedKeyListeners['KeyE'] = true; 
            }
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
            if (typeof window.addedKeyListeners === 'undefined') {
                window.addedKeyListeners = {}; // Initialize an object to track added listeners
            }

            if (!window.addedKeyListeners['KeyR']) { 
                document.addEventListener('keydown', function(event) {
                    if (event.code === 'KeyR') {
                        document.getElementById('propagate_btn').click();
                    }
                });
                window.addedKeyListeners['KeyR'] = true; 
            }
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
            if (typeof window.addedKeyListeners === 'undefined') {
                window.addedKeyListeners = {}; // Initialize an object to track added listeners
            }

            if (!window.addedKeyListeners['KeyP']) { 
                document.addEventListener('keydown', function(event) {
                    if (event.code === 'KeyP') {
                        document.getElementById('skip_btn').click();
                    }
                });
                window.addedKeyListeners['KeyP'] = true; 
            }
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
            if (typeof window.addedKeyListeners === 'undefined') {
                window.addedKeyListeners = {}; // Initialize an object to track added listeners
            }

            if (!window.addedKeyListeners['KeyD']) { 
                document.addEventListener('keydown', function(event) {
                    if (event.code === 'KeyD') {
                        document.getElementById('done_btn').click();
                    }
                });
                window.addedKeyListeners['KeyS'] = true; 
            }
            return "";
        }

        """,
    Output("hidden-div", "children", allow_duplicate=True),
    Input("done_btn", "n_clicks"),
    prevent_initial_call=True,
)

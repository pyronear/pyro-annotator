from dash_annotate_cv.annotate_image_controller import AnnotateImageController
from dash_annotate_cv.helpers import get_trigger_id
from dash_annotate_cv.image_source import IndexAboveError, IndexBelowError

from dash import Output, Input, html, callback, MATCH
import uuid
from typing import Optional, Union, List, Callable
import dash_bootstrap_components as dbc
from dataclasses import dataclass
import logging


logger = logging.getLogger(__name__)


class AnnotateImageControlsAIO(html.Div):
    """Annotation component for images"""

    # A set of functions that create pattern-matching callbacks of the subcomponents
    class ids:
        title = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "title",
            "aio_id": aio_id,
        }
        alert = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "alert",
            "aio_id": aio_id,
        }
        next_submit = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "next_submit",
            "aio_id": aio_id,
        }
        prev = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "prev",
            "aio_id": aio_id,
        }
        fit = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "fit",
            "aio_id": aio_id,
        }
        propagate = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "propagate",
            "aio_id": aio_id,
        }
        content = lambda aio_id: {
            "component": "AnnotateImageLabelsAIO",
            "subcomponent": "content",
            "aio_id": aio_id,
        }

    ids = ids

    def __init__(
        self,
        controller: AnnotateImageController,
        refresh_layout_callback: Callable[[], dbc.Row],
        aio_id: Optional[str] = None,
    ):
        self.controller = controller
        self._refresh_layout_callback = refresh_layout_callback

        # Allow developers to pass in their own `aio_id` if they're
        # binding their own callback to a particular component.
        if aio_id is None:
            # Otherwise use a uuid that has virtually no chance of collision.
            # Uuids are safe in dash deployments with processes
            # because this component's callbacks
            # use a stateless pattern-matching callback:
            # The actual ID does not matter as long as its unique and matches
            # the PMC `MATCH` pattern..
            self.aio_id = str(uuid.uuid4())
        else:
            self.aio_id = aio_id

        super().__init__(self._create_layout())  # Equivalent to `html.Div([...])`
        self._define_callbacks()

    def _define_callbacks(self):
        """Define callbacks, called in constructor"""

        @callback(
            Output(self.ids.title(MATCH), "children"),
            Output(self.ids.content(MATCH), "children"),
            Output(self.ids.alert(MATCH), "children"),
            Input(self.ids.next_submit(MATCH), "n_clicks"),
            Input(self.ids.prev(MATCH), "n_clicks"),
            Input(self.ids.fit(MATCH), "n_clicks"),
            Input(self.ids.propagate(MATCH), "n_clicks"),
        )
        def button_press(
            submit_n_clicks, prev_n_clicks, fit_n_clicks, propagate_n_clicks
        ):
            trigger_id, _ = get_trigger_id()
            logger.debug(f"Trigger: '{trigger_id}'")

            is_initial = trigger_id == ""
            content_layout, alert_layout = None, None

            try:
                if is_initial:
                    # Initial state
                    content_layout = self._refresh_layout_callback()

                elif trigger_id == self.ids.next_submit(MATCH)["subcomponent"]:
                    # Submit button was pressed
                    self.controller.next_image()
                    content_layout = self._refresh_layout_callback()

                elif trigger_id == self.ids.prev(MATCH)["subcomponent"]:
                    # Previous button was pressed
                    self.controller.previous_image()
                    content_layout = self._refresh_layout_callback()

                elif trigger_id == self.ids.fit(MATCH)["subcomponent"]:
                    # Skip button was pressed
                    self.controller.fit_bbox()
                    content_layout = self._refresh_layout_callback()

                elif trigger_id == self.ids.propagate(MATCH)["subcomponent"]:
                    # Skip button was pressed
                    self.controller.propagate_bbox()
                    content_layout = self._refresh_layout_callback()

                else:
                    logger.debug(f"Unknown button pressed: {trigger_id}")

            except IndexAboveError:
                alert_layout = dbc.Alert("Finished all images", color="success")

            except IndexBelowError:
                alert_layout = dbc.Alert("Start of images", color="danger")

            title_layout = self._create_title_layout()

            return title_layout, content_layout, alert_layout

    def _create_layout(self):
        """Create layout for component"""
        return dbc.Row(
            [
                dbc.Row(
                    [
                        dbc.Col(html.Div(id=self.ids.title(self.aio_id)), md=6),
                        dbc.Col(self._create_layout_buttons(self.aio_id), md=6),
                    ]
                ),
                dbc.Col(html.Hr(), xs=12),
                dbc.Col(id=self.ids.alert(self.aio_id), xs=12),
                dbc.Col(id=self.ids.content(self.aio_id), xs=12),
            ]
        )

    @dataclass
    class EnableButtons:
        """Layout for buttons"""

        prev_btn: bool = True
        next_btn: bool = True
        skip_btn: bool = True
        skip_to_next_btn: bool = True

    def _create_layout_buttons(
        self, aio_id: str, enable: EnableButtons = EnableButtons()
    ):
        """Create layout for buttons"""
        style_prev = {
            "backgroundColor": "#FD5252",
            "width": "100%",
            "border": "none",
        }
        style_next_save = {
            "backgroundColor": "#FEBA6A",
            "width": "100%",
            "border": "none",
        }
        style_fit = {
            "backgroundColor": "#2C796E",
            "width": "100%",
            "border": "none",
        }
        style_propagate = {
            "backgroundColor": "#054546",
            "width": "100%",
            "border": "none",
        }
        if not enable.prev_btn:
            style_prev["display"] = "none"
        if not enable.next_btn:
            style_next_save["display"] = "none"

        # Create components
        prev_button = dbc.Button(
            "Previous image", color="dark", id=self.ids.prev(aio_id), style=style_prev
        )
        next_button = dbc.Button(
            "Next (save)",
            color="success",
            id=self.ids.next_submit(aio_id),
            style=style_next_save,
        )
        fit_button = dbc.Button(
            "Fit Bbox", color="dark", id=self.ids.fit(aio_id), style=style_fit
        )
        propagate_button = dbc.Button(
            "Propagate",
            color="dark",
            id=self.ids.propagate(aio_id),
            style=style_propagate,
        )

        return dbc.Col(
            [
                dbc.Row(
                    [
                        dbc.Col(prev_button, md=3),
                        dbc.Col(next_button, md=3),
                        dbc.Col(fit_button, md=3),
                        dbc.Col(propagate_button, md=3),
                    ]
                ),
            ]
        )

    def _create_title_layout(self):
        if self.controller.curr is not None:
            no_images = self.controller.no_images
            title = f"Image {self.controller.curr.image_idx+1}/{no_images}"
        else:
            title = "Image"
        return html.H2(title)

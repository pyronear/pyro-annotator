from dash_annotate_cv.annotate_image_controller import (
    AnnotateImageController,
    AnnotateImageOptions,
    Bbox,
    BboxUpdate,
    NoUpdate,
)
from dash_annotate_cv.annotate_image_controls import AnnotateImageControlsAIO
from dash_annotate_cv.helpers import get_trigger_id, Xyxy
from dash_annotate_cv.image_source import ImageSource
from dash_annotate_cv.label_source import LabelSource
from dash_annotate_cv.formats.image_annotations import ImageAnnotations
from dash_annotate_cv.annotation_storage import AnnotationStorage
import dash_annotate_cv as dacv
from typing import Optional
import plotly.express as px
from dash import dcc, html, Input, Output, no_update, callback, State
from dash import Output, Input, html, dcc, callback, MATCH, ALL
from typing import Optional, List, Dict, Any
import plotly.express as px
import dash_bootstrap_components as dbc
from dataclasses import dataclass
import logging
from dash.exceptions import PreventUpdate
import os
import glob
import random
from PIL import Image

logger = logging.getLogger(__name__)


class AnnotateImageBboxsAIO(html.Div):
    """Annotation component for images"""

    # A set of functions that create pattern-matching callbacks of the subcomponents
    class ids:
        bbox_labeling = lambda aio_id: {
            "component": "AnnotateImageBboxsAIO",
            "subcomponent": "bbox_labeling",
            "aio_id": aio_id,
        }
        image = lambda aio_id: {
            "component": "AnnotateImageBboxsAIO",
            "subcomponent": "image",
            "aio_id": aio_id,
        }
        graph_picture = lambda aio_id: {
            "component": "AnnotateImageBboxsAIO",
            "subcomponent": "graph_picture",
            "aio_id": aio_id,
        }
        highlight_bbox = lambda aio_id, idx: {
            "component": "AnnotateImageBboxsAIO",
            "subcomponent": "highlight_bbox",
            "aio_id": aio_id,
            "idx": idx,
        }
        delete_button = lambda aio_id, idx: {
            "component": "AnnotateImageBboxsAIO",
            "subcomponent": "delete_button",
            "aio_id": aio_id,
            "idx": idx,
        }
        alert = lambda aio_id: {
            "component": "AnnotateImageBboxsAIO",
            "subcomponent": "alert",
            "aio_id": aio_id,
        }

    ids = ids

    def __init__(
        self,
    ):

        self._pick_fire()

    def _pick_fire(self):
        fires = glob.glob("Data/to_do/*")
        fire = random.choice(fires)
        images_files = glob.glob(f"{fire}/images/*")

        images_pil = [
            (os.path.basename(file), Image.open(file)) for file in images_files
        ]

        print(fire, len(images_files))
        self.options = dacv.AnnotateImageOptions()

        # Set up the image and label sources
        image_source = dacv.ImageSource(images=images_pil)
        label_source = dacv.LabelSource(labels=["smoke"])

        # Set up writing
        storage = dacv.AnnotationStorage(
            storage_types=[
                dacv.StorageType.JSON,  # Default storage type
            ],
            json_file=f"{fire}.json",
        )
        annotations_existing = dacv.load_image_anns_from_storage(storage)
        self.controller = AnnotateImageController(
            label_source=label_source,
            image_source=image_source,
            annotation_storage=storage,
            annotations_existing=annotations_existing,
            options=self.options,
        )
        self.converter = BboxToShapeConverter(options=self.options)
        self.controls = AnnotateImageControlsAIO(
            controller=self.controller,
            refresh_layout_callback=self._create_layout,
        )
        self.aio_id = self.controls.aio_id
        print("self.aio_id", self.aio_id)
        super().__init__(self.controls)  # Equivalent to `html.Div([...])`
        self._define_callbacks()

    def _create_layout(self):
        """Create layout for component"""
        logger.debug("Creating layout for component")

        # Generate a unique key based on self.aio_id
        unique_key = f"layout-{self.aio_id}"

        curr_image_layout = self._create_layout_for_curr_image()

        return dbc.Row(
            [
                dbc.Col(
                    [
                        # Use the unique_key as the key property for the div
                        html.Div(curr_image_layout, id=self.ids.image(self.aio_id), key=unique_key)
                    ], 
                    md=11
                ),
                dbc.Col(
                    [
                        html.Div(id=self.ids.alert(self.aio_id), key=f"alert-{unique_key}"),
                        html.Div(style={"margin-bottom": "20px"}),
                        html.Div(id=self.ids.bbox_labeling(self.aio_id), key=f"labeling-{unique_key}"),
                    ], 
                    md=1,
                ),
            ]
        )


    def _create_layout_for_curr_image(self):
        """Create layout for the image"""
        image = self.controller.curr.image if self.controller.curr is not None else None
        if image is None:
            return []
        fig = px.imshow(image)
        rgb = self.options.default_bbox_color
        line_color = "rgba(%d,%d,%d,1)" % rgb
        line_width = 1
        fig.update_layout(
            dragmode="drawrect",
            newshape=dict(line_color=line_color, line_width=line_width),
            margin=dict(l=0, r=0, t=0, b=0),  # Remove margins
            autosize=True,
            # Make the plot responsive to the window size
            template=None,  # Remove default Plotly styling
        )

        for trace in fig.data:
            trace.update(hoverinfo="none", hovertemplate=None)

        return dcc.Graph(
            id=self.ids.graph_picture(self.aio_id),
            figure=fig,
            style={"height": "calc(100vh - 120px)"},
        )

    def _create_bbox_layout(self):
        if self.controller.curr is None:
            logger.debug("Creating bbox layout - no curr image")
            return no_update

        if self.controller.curr.bboxs is None:
            logger.debug("Creating bbox layout - no bboxs")
            bbox_list_group = []
        else:
            logger.debug(
                f"Creating bbox layout - num bboxs: {len(self.controller.curr.bboxs)}"
            )
            bbox_list_group = [
                self._create_list_group_for_bbox_layout(bbox, idx)
                for idx, bbox in enumerate(self.controller.curr.bboxs)
            ]

        return dbc.ListGroup(bbox_list_group)

    def _create_list_group_for_bbox_layout(self, bbox: Bbox, bbox_idx: int):
        button_delete = dbc.Button(
            "D",
            color="danger",
            size="sm",
            className="mr-1",
            id=self.ids.delete_button(self.aio_id, bbox_idx),
        )

        button_highlight = dbc.Button(
            "H",
            color="primary",
            size="sm",
            className="mr-1",
            id=self.ids.highlight_bbox(self.aio_id, bbox_idx),
        )

        bbox_index_label = dbc.Label(
            f"{bbox_idx}",
            color="secondary",
            className="mr-1",
        )

        return dbc.ListGroupItem(
            [
                dbc.Row(
                    [
                        dbc.Col(
                            bbox_index_label, width={"size": 1}
                        ),  # Adjust the size as needed
                        dbc.Col(
                            button_highlight,
                            width={"size": 1},
                            className="mx-1",  # Adds a margin on the left and right
                        ),
                        dbc.Col(
                            button_delete,
                            width={"size": 1},
                            className="mx-1",  # Adds a margin on the left and right
                        ),
                    ],
                )
            ]
        )

    def _create_alert_layout(self):
        alerts = []

        return alerts

    def _define_callbacks(self):
        """Define callbacks"""
        logger.debug("Defining callbacks")

        @callback(
            Output(self.ids.bbox_labeling(MATCH), "children"),
            Output(self.ids.graph_picture(MATCH), "figure"),
            Output(self.ids.alert(MATCH), "children"),
            Input(self.ids.graph_picture(MATCH), "relayoutData"),
            Input(self.ids.delete_button(MATCH, ALL), "n_clicks"),
            Input(self.ids.highlight_bbox(MATCH, ALL), "n_clicks"),
            Input("skip", "n_clicks"),
            Input("done", "n_clicks"),
            State(self.ids.graph_picture(MATCH), "figure"),
        )
        def update(
            relayout_data,
            n_clicks_delete,
            n_clicks_select,
            n_clicks_skip,
            n_clicks_done,
            figure,
        ):

            trigger_id, idx = get_trigger_id()
            logger.debug(f"Update: trigger ID: {trigger_id} idx: {idx}")

            if trigger_id == "delete_button":
                logger.debug("Pressed delete_button")
                assert idx is not None, "idx should not be None"
                update = self._handle_delete_button_pressed(idx, figure)

            elif trigger_id == "highlight_bbox":
                logger.debug("Pressed highlight_bbox")
                assert idx is not None, "idx should not be None"
                update = self._handle_highlight_button_pressed(idx, figure)

            elif trigger_id == "graph_picture":

                if relayout_data is not None and "shapes" in relayout_data:
                    # A new box was drawn
                    # We receive all boxes from the data
                    update = self._handle_new_box_drawn(relayout_data)
                elif relayout_data is not None and "shapes" in " ".join(
                    list(relayout_data.keys())
                ):
                    # A box was updated
                    update = self._handle_box_updated(relayout_data)
                else:
                    logger.warning(f"Unrecognized trigger for {trigger_id}")
                    # Just draw latest
                    self.converter.refresh_figure_shapes(
                        figure, self.controller.curr_bboxs
                    )
                    update = AnnotateImageBboxsAIO.Update(
                        self._create_bbox_layout(), figure, self._create_alert_layout()
                    )

            elif trigger_id == "skip":
                print("skip")
                self._pick_fire()
                update = AnnotateImageBboxsAIO.Update(
                    self._create_bbox_layout(), figure, self._create_alert_layout()
                )

            elif trigger_id == "done":
                print("done")
                self._pick_fire()
                update = AnnotateImageBboxsAIO.Update(
                    self._create_bbox_layout(), figure, self._create_alert_layout()
                )

            else:
                logger.warning(f"Unrecognized trigger ID: {trigger_id}")
                # Just draw latest
                self.converter.refresh_figure_shapes(figure, self.controller.curr_bboxs)
                update = AnnotateImageBboxsAIO.Update(
                    self._create_bbox_layout(), figure, self._create_alert_layout()
                )

            return update.bbox_layout, update.figure, update.alert

        logger.debug("Defined callbacks")

    @dataclass
    class Update:
        bbox_layout: Any
        figure: Any
        alert: Any

    def _handle_delete_button_pressed(self, idx: int, figure: Dict) -> Update:
        logger.debug(f"Deleting bbox idx: {idx}")
        self.controller.delete_bbox(idx)
        self.converter.refresh_figure_shapes(figure, self.controller.curr_bboxs)
        return AnnotateImageBboxsAIO.Update(
            self._create_bbox_layout(), figure, self._create_alert_layout()
        )

    def _handle_highlight_button_pressed(self, idx: int, figure: Dict) -> Update:
        self.controller.curr_bboxs[idx].is_highlighted = not self.controller.curr_bboxs[
            idx
        ].is_highlighted
        self.converter.refresh_figure_shapes(figure, self.controller.curr_bboxs)
        return AnnotateImageBboxsAIO.Update(
            no_update, figure, self._create_alert_layout()
        )

    def _handle_new_box_drawn(self, relayout_data: Dict) -> Update:
        new_shape = relayout_data["shapes"][-1]
        new_bbox = self.converter.shape_to_bbox(new_shape)
        self.controller.add_bbox(new_bbox)
        return AnnotateImageBboxsAIO.Update(
            self._create_bbox_layout(), no_update, self._create_alert_layout()
        )

    def _handle_box_updated(self, relayout_data: Dict) -> Update:

        # Parse shapes[0].x1 -> 0 from the brackets
        label = list(relayout_data.keys())[0]
        box_idx = int(label.split(".")[0].replace("shapes[", "").replace("]", ""))
        shapes_label = "shapes[%d]" % box_idx
        xyxy = [
            relayout_data["%s.%s" % (shapes_label, label)]
            for label in ["x0", "y0", "x1", "y1"]
        ]

        # Update
        update = BboxUpdate(box_idx, xyxy_new=xyxy)
        self.controller.update_bbox(update)
        return AnnotateImageBboxsAIO.Update(
            self._create_bbox_layout(), no_update, self._create_alert_layout()
        )


class BboxToShapeConverter:

    def __init__(self, options: AnnotateImageOptions):
        """Converter betweeen bbox and shape formats

        Args:
            options (AnnotateImageOptions): Options
        """
        options.check_valid()
        self.options = options

    def refresh_figure_shapes(self, figure: Dict, bboxs: Optional[List[Bbox]]):
        """Set shapes in the given figure dict from the provided bboxs

        Args:
            figure (Dict): Figure dict
            bboxs (Optional[List[Bbox]]): Bboxs
        """
        figure["layout"]["shapes"] = self.bboxs_to_shapes(bboxs)

    def shape_to_bbox(self, shape: Dict) -> Bbox:
        """Convert shape to bbox

        Args:
            shape (Dict): Shape

        Returns:
            Bbox: Bbox
        """
        xyxy: Xyxy = [shape[c] for c in ["x0", "y0", "x1", "y1"]]
        return Bbox(xyxy, None)

    def bboxs_to_shapes(self, bboxs: Optional[List[Bbox]]) -> List[Dict]:
        """Convert bboxs to shapes

        Args:
            bboxs (Optional[List[Bbox]]): Bboxs

        Returns:
            List[Dict]: Shapes
        """
        if bboxs is None:
            return []
        return [self.bbox_to_shape(bbox) for bbox in bboxs]

    def bbox_to_shape(self, bbox: Bbox) -> Dict:
        """Convert bbox to shape

        Args:
            bbox (Bbox): Bbox

        Returns:
            Dict: Shape
        """
        # Line color
        if bbox.class_name is None:
            rgb = self.options.default_bbox_color
            if bbox.is_highlighted:
                rgb = (255, 0, 0)
        else:
            rgb = self.options.get_assign_color_for_class(bbox.class_name)
        line_color = "rgba(%d,%d,%d,1)" % rgb

        # Fill color
        if bbox.is_highlighted:
            fill_color = "rgba(%d,%d,%d,0.45)" % rgb
        else:
            fill_color = "rgba(0,0,0,0)"

        return {
            "editable": True,
            "visible": True,
            "showlegend": False,
            "legend": "legend",
            "legendgroup": "",
            "legendgrouptitle": {"text": ""},
            "legendrank": 1000,
            "label": {"text": "", "texttemplate": ""},
            "xref": "x",
            "yref": "y",
            "layer": "above",
            "opacity": 1,
            "line": {"color": line_color, "width": 4, "dash": "solid"},
            "fillcolor": fill_color,
            "fillrule": "evenodd",
            "type": "rect",
            "x0": bbox.xyxy[0],
            "y0": bbox.xyxy[1],
            "x1": bbox.xyxy[2],
            "y1": bbox.xyxy[3],
        }

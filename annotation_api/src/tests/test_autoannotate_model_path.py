"""The configured auto-annotate model path must hold the baked weights.

The default and the Dockerfile's extraction path drifted apart the day both
were written (commit 9dc4c7d): the default named a subdirectory the tarball
never creates, so anything running without an explicit override died at its
first auto-annotate job with "No .onnx file found". Production only worked
because two compose files set the variable by hand.

This test reads the setting exactly as `app.worker.get_detector` does and
checks the directory actually contains weights, so the default cannot drift
from the image again without CI saying so.
"""

from pathlib import Path

from app.core.config import settings


def test_autoannotate_model_path_holds_the_weights():
    model_dir = Path(settings.AUTOANNOTATE_MODEL_PATH)
    assert model_dir.is_dir(), (
        f"AUTOANNOTATE_MODEL_PATH={model_dir} is not a directory. "
        "The Dockerfile extracts the model tarball into /app/models."
    )
    weights = sorted(model_dir.glob("*.onnx"))
    assert weights, (
        f"no .onnx file under AUTOANNOTATE_MODEL_PATH={model_dir}; "
        f"contents: {sorted(p.name for p in model_dir.iterdir())}"
    )

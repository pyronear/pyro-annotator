import pytest

from app.services.localization_rule import needs_localization


@pytest.mark.parametrize(
    ("has_smoke", "has_missed_smoke", "is_unsure", "expected"),
    [
        (True, False, False, True),  # plain smoke lane
        (False, True, False, True),  # missed-smoke-only lane (#217)
        (True, True, False, True),  # both
        (False, False, False, False),  # FP-only lane
        (True, False, True, False),  # unsure smoke lane
        (False, True, True, False),  # unsure missed-smoke lane
        (True, True, True, False),  # unsure, both
        (False, False, True, False),  # unsure FP lane
    ],
)
def test_needs_localization_truth_table(
    has_smoke, has_missed_smoke, is_unsure, expected
):
    assert needs_localization(has_smoke, has_missed_smoke, is_unsure) is expected

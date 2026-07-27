from app.models import FalsePositiveType, SmokeType

from scripts.data_transfer.ingestion.alert_api import label_classes as lc


class TestClassRegistrySync:
    def test_smoke_classes_cover_smoke_type_enum(self):
        assert set(lc.SMOKE_CLASSES) == {t.value for t in SmokeType}

    def test_fp_classes_cover_false_positive_type_enum(self):
        fp_types = {lc.fp_type_from_class_name(name) for name in lc.FP_CLASSES}
        assert fp_types == {t.value for t in FalsePositiveType}

    def test_fp_classes_all_prefixed(self):
        assert all(name.startswith(lc.FP_CLASS_PREFIX) for name in lc.FP_CLASSES)

    def test_class_ids_unique_and_roundtrip(self):
        assert len(lc.CLASS_ID) == len(lc.CLASS_NAMES)
        for name, class_id in lc.CLASS_ID.items():
            assert lc.class_id_to_name(class_id) == name

    def test_smoke_and_fp_id_ranges(self):
        for name in lc.SMOKE_CLASSES:
            assert not lc.is_fp_class_id(lc.CLASS_ID[name])
        for name in lc.FP_CLASSES:
            assert lc.is_fp_class_id(lc.CLASS_ID[name])

    def test_legacy_smoke_ids_are_stable(self):
        # Ids 0-2 are persisted in label folders pulled before the registry
        # existed; they must never change.
        assert lc.CLASS_NAMES[:3] == ["wildfire", "industrial", "other"]

    def test_fp_class_order_is_stable(self):
        # Ids 3+ are persisted in label folders on disk; the order is the
        # contract and must stay append-only (a mid-list insert would shift
        # every id after it and silently corrupt old folders).
        assert lc.FP_CLASSES == [
            "fp_antenna",
            "fp_building",
            "fp_cliff",
            "fp_dark",
            "fp_dust",
            "fp_high_cloud",
            "fp_low_cloud",
            "fp_lens_flare",
            "fp_lens_droplet",
            "fp_light",
            "fp_rain",
            "fp_trail",
            "fp_road",
            "fp_sky",
            "fp_tree",
            "fp_water_body",
            "fp_other",
            "fp_unlabeled",
        ]


class TestHelpers:
    def test_smoke_class_name(self):
        assert lc.smoke_class_name("industrial") == "industrial"
        assert lc.smoke_class_name(None) == "wildfire"
        assert lc.smoke_class_name("bogus") == "wildfire"

    def test_fp_class_name(self):
        assert lc.fp_class_name("antenna") == "fp_antenna"
        assert lc.fp_class_name(None) == "fp_unlabeled"
        assert lc.fp_class_name("bogus") == "fp_unlabeled"

    def test_class_id_to_name_unknown(self):
        assert lc.class_id_to_name(len(lc.CLASS_NAMES)) is None
        assert lc.class_id_to_name(-1) is None

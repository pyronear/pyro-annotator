import glob
import json
import os
import pathlib

import streamlit as st

# Inject JavaScript to scroll to the top
scroll_to_top = """
<script>
    window.scrollTo(0, 0);
</script>
"""
st.markdown(scroll_to_top, unsafe_allow_html=True)

st.title("Automatic Image Annotation Review")

# === Chemins
all_sequences_folder_path = "../pyro-dataset/data/raw/pyronear-platform/sequences/sis-67_test2/sis-67"
json_path = pathlib.Path(all_sequences_folder_path).parent
json_file = os.path.join(json_path, "all_sequences.json")

# === Chargement JSON
with open(json_file, "r") as f:
    all_sequences = json.load(f)

# === Sélection des séquences à annoter
temp_dict = {}
unannotated = [k for k, v in all_sequences.items() if not v.get("is_annotated", False)]
fire_events = [os.path.join(all_sequences_folder_path, k, "sequence_labeling_data") for k in unannotated]
fire_events.sort()

# === Barre de progression
st.write(f"Progression : {round(1 - len(fire_events) / len(all_sequences), 3)!s} %")
if fire_events:
    st.progress((len(all_sequences) - len(fire_events)) / len(all_sequences))

# === Interface principale
if len(fire_events):
    fire_event = fire_events[0]
    name = pathlib.Path(pathlib.Path(fire_event).parent).name
    st.write(f"📁 Sequence: {name}")

    gif_images = glob.glob(f"{fire_event}/candidate_*.gif")
    gif_images.sort()

    if len(gif_images) == 0:
        all_sequences[name]["is_annotated"] = True
        with open(json_file, "w") as f:
            json.dump(all_sequences, f, indent=2)
        st.success("Validation results saved! Moving to the next directory.")
        st.rerun()

    for idx, gif_path in enumerate(gif_images):
        gif_id = pathlib.Path(gif_path).name.replace("candidate_", "").replace(".gif", "")
        st.image(gif_path, caption=f"Prediction {idx + 1}", use_container_width=True)

        annotation = st.selectbox(
            f"Label for Prediction {idx + 1}",
            ["Smoke", "Industrial_smoke", "Sun flare", "Cloud", "Building", "Antenna", "Other"],
            key=f"label_{idx}",
        )
        temp_dict[gif_id] = annotation

        st.markdown("---")

        with st.sidebar:
            crop_path = gif_path.replace("candidate_", "crop_")
            if pathlib.Path(crop_path).exists():
                st.image(crop_path, caption=pathlib.Path(crop_path).name, use_container_width=True)

    st.markdown("## Extra Options")
    add_smoke = st.checkbox("🚨 There is a smoke event not detected by the model")

    col1, col2 = st.columns(2)

    with col1:
        if st.button("Submit Annotation Results"):
            # === Mise à jour de l'entrée JSON
            all_sequences[name]["is_annotated"] = True

            has_smoke = False
            has_fp = False

            for k, v in temp_dict.items():
                if k in all_sequences[name]["detected_smoke"]:
                    all_sequences[name]["detected_smoke"][k]["annotation"] = v
                    if v == "Smoke":
                        has_smoke = True
                    else:
                        has_fp = True

            if add_smoke:
                has_smoke = True

            all_sequences[name]["has_smoke"] = has_smoke
            all_sequences[name]["has_fp"] = has_fp

            with open(json_file, "w") as f:
                json.dump(all_sequences, f, indent=2)

            st.success("Annotations saved! Moving to the next sequence.")
            st.rerun()

    with col2:
        if st.button("Pass"):
            all_sequences[name]["is_annotated"] = True
            with open(json_file, "w") as f:
                json.dump(all_sequences, f, indent=2)
            st.success("Sequence skipped.")
            st.rerun()
else:
    st.success("✅ All sequences reviewed!")

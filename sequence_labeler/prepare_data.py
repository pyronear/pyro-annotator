import glob
import json
import os
import pathlib
from multiprocessing import Pool, cpu_count

from tqdm import tqdm
from utils import generate_candidate_gifs, prepare_candidates_with_context

# ✏️ Update this to your root folder of all sequences
all_sequences_folder_path = "../arthur/pyro-dataset/data/raw/pyronear-platform/sequences/sis-67_test2/sis-67"
parent_folder = pathlib.Path(all_sequences_folder_path).parent


def process_sequence(sequences_folder):
    sequence_name = pathlib.Path(sequences_folder).name

    try:
        candidates_with_context = prepare_candidates_with_context(
            sequences_folder=sequences_folder, iou_thresh=0.1, conf_thresh=0.1
        )

        out_dir = os.path.join(sequences_folder, "sequence_labeling_data")

        for i, (candidate, cand_file, context_files) in enumerate(candidates_with_context):
            generate_candidate_gifs(
                i=i,
                candidate=candidate,
                context_files=context_files,
                out_dir=out_dir,
            )

        detected_smoke = {
            f"{i:03d}": {
                "file": pathlib.Path(cand_file).name,
                "bbox": candidate[:4].tolist(),
                "score": float(candidate[4]),
            }
            for i, (candidate, cand_file, _) in enumerate(candidates_with_context)
        }

        return sequence_name, {"is_annotated": False, "detected_smoke": detected_smoke}

    except Exception as e:
        print(f"❌ Error in {sequence_name}: {e}")
        return None


def main():
    big_json_path = os.path.join(parent_folder, "all_sequences.json")

    # Load existing metadata
    if pathlib.Path(big_json_path).is_file():
        with open(big_json_path, "r") as f:
            all_sequences_data = json.load(f)
    else:
        all_sequences_data = {}

    already_done = set(all_sequences_data.keys())

    # Find all sequences to process
    sequences_folders = glob.glob(f"{all_sequences_folder_path}/*")
    sequences_folders.sort()
    sequences_to_process = [folder for folder in sequences_folders if pathlib.Path(folder).name not in already_done]

    if not sequences_to_process:
        print("✅ All sequences already processed.")
        return

    # Run multiprocessing pool
    with Pool(processes=min(cpu_count(), len(sequences_to_process))) as pool:
        results = list(tqdm(pool.imap(process_sequence, sequences_to_process), total=len(sequences_to_process)))

    # Update global JSON
    for res in results:
        if res is not None:
            name, data = res
            all_sequences_data[name] = data

    # Save updated metadata
    os.makedirs(parent_folder, exist_ok=True)
    with open(big_json_path, "w") as f:
        json.dump(all_sequences_data, f, indent=2)

    print(f"✅ Saved updated metadata to {big_json_path}")


if __name__ == "__main__":
    main()

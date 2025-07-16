import glob
import json
import os
import pathlib
from multiprocessing import Pool, cpu_count
import time
from tqdm import tqdm
from utils import generate_candidate_gifs, prepare_candidates_with_context



def process_sequence(sequences_folder):
    sequence_name = pathlib.Path(sequences_folder).name
    print(f"\n🔄 Starting processing for sequence: {sequence_name}")

    try:
        start_total = time.time()

        # Step 1: Prepare candidates
        print("⏳ Step 1: Preparing candidates with context...")
        start_step = time.time()
        candidates_with_context = prepare_candidates_with_context(
            sequences_folder=sequences_folder, iou_thresh=0.1, conf_thresh=0.1
        )
        print(f"✅ Step 1 done in {time.time() - start_step:.2f} seconds")

        # Step 2: Generate GIFs
        print("⏳ Step 2: Generating GIFs...")
        out_dir = os.path.join(sequences_folder, "sequence_labeling_data")
        start_step = time.time()
        for i, (candidate, cand_file, context_files) in enumerate(candidates_with_context):
            generate_candidate_gifs(
                i=i,
                candidate=candidate,
                context_files=context_files,
                out_dir=out_dir,
            )
        print(f"✅ Step 2 done in {time.time() - start_step:.2f} seconds")

        # Step 3: Build output dict
        print("⏳ Step 3: Building output dictionary...")
        start_step = time.time()
        detected_smoke = {
            f"{i:03d}": {
                "file": pathlib.Path(cand_file).name,
                "bbox": candidate[:4].tolist(),
                "score": float(candidate[4]),
            }
            for i, (candidate, cand_file, _) in enumerate(candidates_with_context)
        }
        print(f"✅ Step 3 done in {time.time() - start_step:.2f} seconds")

        print(f"🎉 Finished processing {sequence_name} in {time.time() - start_total:.2f} seconds")

        return sequence_name, {"is_annotated": False, "detected_smoke": detected_smoke}

    except Exception as e:
        print(f"❌ Error in {sequence_name}: {e}")
        return None


sequences_folders = glob.glob(f"../aa_test/*")
sequences_folders.sort()

st = time.time()

for folder in sequences_folders:
    print(folder)

print(f"Done all {len(sequences_folders)} fodlers in {time.time()-st}")
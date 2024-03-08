import glob
import os
from datetime import datetime
import shutil
import re
from tqdm import tqdm


imgs = glob.glob(
    "/home/mateo/pyronear/vision/dataset/dataset/pyro-dataset/frames_processed/**/*.jpg"
)
imgs.sort()
print(len(imgs))


t0 = datetime.now()
fires = {}
current_fire = []
for file in tqdm(imgs, desc="Split fires"):
    match = re.search(r"(\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2})", file)
    t = datetime.strptime(match.group(), "%Y_%m_%dT%H_%M_%S")

    if abs((t - t0).total_seconds()) < 30 * 60:  # 30mn
        current_fire.append(file)
    else:
        if len(current_fire):
            fires[len(fires)] = current_fire
            current_fire = []
        else:
            current_fire.append(file)

    t0 = t


for k, images_files in tqdm(fires.items(), desc="Save folders"):
    if len(images_files) > 4:
        fire_name = os.path.basename(images_files[0]).split(".")[0]

        for file in images_files:
            os.makedirs(f"data/images_no_embeddings/{fire_name}", exist_ok=True)

            shutil.copy(
                file,
                os.path.join(
                    f"data/images_no_embeddings/{fire_name}", os.path.basename(file)
                ),
            )

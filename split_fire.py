import glob
import os
from datetime import datetime
import shutil


imgs = glob.glob("annotations/images/*")
imgs.sort()
len(imgs)

t0 = datetime.now()
fires = {}
current_fire = []
for file in imgs:
    t = os.path.basename(file).split(".")[0].split("2023")[1]
    t = datetime.strptime("2023" + t, "%Y_%m_%dT%H_%M_%S")

    if abs((t - t0).total_seconds()) < 30 * 60:  # 30mn
        current_fire.append(file)
    else:
        if len(current_fire):
            fires[len(fires)] = current_fire
            current_fire = []
        else:
            current_fire.append(file)

    t0 = t


for k, images_files in fires.items():
    fire_name = os.path.basename(images_files[0]).split(".")[0]

    for file in images_files:
        os.makedirs(f"Data/{fire_name}/images", exist_ok=True)
        os.makedirs(f"Data/{fire_name}/embeddings", exist_ok=True)

        shutil.copy(
            file, file.replace("annotations/images", f"Data/{fire_name}/images")
        )
        embed_file = file.replace("jpg", "pth").replace("images", "embeddings")
        shutil.copy(
            embed_file,
            embed_file.replace(
                "annotations/embeddings", f"Data/{fire_name}/embeddings"
            ),
        )

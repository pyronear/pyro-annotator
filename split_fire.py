import glob
import os
from datetime import datetime
import shutil


imgs = glob.glob("data/images/*")
imgs.sort()
print(len(imgs))


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
    if len(images_files) > 4:
        fire_name = os.path.basename(images_files[0]).split(".")[0]

        for file in images_files:
            os.makedirs(f"data/to_do/{fire_name}", exist_ok=True)

            shutil.copy(file, file.replace("data/images", f"data/to_do/{fire_name}"))

import glob
import json
import os
import pathlib
import shutil

import numpy as np
from PIL import Image

done_taks = glob.glob("data/labels/done/*.json")
print(f"There is {len(done_taks)} done task")

# Make dataset
dataset_folder = "data/Dataset/"

os.makedirs(f"{dataset_folder}/images", exist_ok=True)
os.makedirs(f"{dataset_folder}/labels", exist_ok=True)

for label_file in done_taks:
    with open(label_file, "r") as file:
        data = json.load(file)

    for k, v in data.items():
        im = Image.open(k.replace("to_do", "done"))
        w, h = im.size
        label = ""
        for box in v:
            x1, y1, x2, y2 = np.array(box)
            bw = x2 - x1
            bh = y2 - y1
            xc = x1 + bw / 2
            yc = y1 + bh / 2

            label += f"0 {np.round(xc / w, 6)} {np.round(yc / h, 6)} {np.round(bw / w, 6)} {np.round(bh / h, 6)}\n"

        new_label_file = os.path.join(f"{dataset_folder}/labels", pathlib.Path(k).name.split(".")[0] + ".txt")
        with open(new_label_file, "w") as file:
            file.write(label)

    img_folder = label_file.replace("labels/", "").split(".")[0]
    imgs = glob.glob(f"{img_folder}/*")
    for file in imgs:
        shutil.copy(file, os.path.join(f"{dataset_folder}/images", pathlib.Path(file).name))


images = glob.glob(f"{dataset_folder}/images/*.jpg")
print(f"There is {len(images)} images")
labels = glob.glob(f"{dataset_folder}/labels/*.txt")
print(f"There is {len(labels)} labels with label")

import glob
import json
import os
import pathlib
import shutil
from datetime import datetime

import boto3
import numpy as np
from PIL import Image
from tqdm import tqdm


def normalize_labels(labels_file, cat="done"):
    with open(labels_file, "r") as file:
        labels = json.load(file)

    with open("data/image_size.json", "r") as file:
        image_size_dict = json.load(file)

    name = pathlib.Path(task).name.split(".")[0]
    _, h = image_size_dict[name]
    r = 720 / h

    for k in list(labels.keys()):
        im = Image.open(k.replace("to_do", cat))
        w, h = im.size
        box = labels[k]
        new_box = []
        for b in box:
            bbox = np.array(b).astype("float")
            bbox[::2] *= 1 / r
            bbox[1::2] *= 1 / r

            new_box.append(list(np.round(bbox)))

        labels[k] = new_box

    with open(labels_file, "w") as file:
        json.dump(labels, file)


if __name__ == "__main__":
    bucket_name = "pyro-annotator"  # Change this to your bucket name

    s3 = boto3.client("s3")

    s3.download_file(bucket_name, "task_status.json", "data/task_status.json")
    with open("data/task_status.json", "r") as file:
        task_status = json.load(file)

    done_tasks = glob.glob("data/labels/done/*.json")
    for task in tqdm(done_tasks, desc="Upload done tasks"):
        backuped_task = task.replace("labels", "backup/labels")
        os.makedirs(pathlib.Path(backuped_task).parent, exist_ok=True)
        shutil.copy(task, backuped_task)
        normalize_labels(task)
        name = pathlib.Path(task).name.split(".")[0]
        if name in task_status.keys():
            if task_status[name]["status"] != "done":
                task_status[name]["status"] = "done"
                task_status[name]["last_update"] = datetime.now().isoformat()

                s3.upload_file(task, bucket_name, task.split("data/")[1])
                pathlib.Path(task).unlink()

    done_tasks = glob.glob("data/labels/skip/*.json")
    for task in tqdm(done_tasks, desc="Upload skip tasks"):
        backuped_task = task.replace("labels", "backup/labels")
        os.makedirs(pathlib.Path(backuped_task).parent, exist_ok=True)
        shutil.copy(task, backuped_task)
        normalize_labels(task, cat="skip")
        name = pathlib.Path(task).name.split(".")[0]
        if name in task_status.keys():
            if task_status[name]["status"] != "skip":
                task_status[name]["status"] = "skip"
                task_status[name]["last_update"] = datetime.now().isoformat()

                s3.upload_file(task, bucket_name, task.split("data/")[1])
                pathlib.Path(task).unlink()

    with open("data/task_status.json", "w") as file:
        json.dump(task_status, file)

    s3.upload_file("data/task_status.json", bucket_name, "task_status.json")

import boto3
import os
from tqdm import tqdm
import glob
from datetime import datetime
import json
from PIL import Image
import numpy as np
import shutil


def normalize_labels(labels_file, cat="done"):
    with open(labels_file, "r") as file:
        labels = json.load(file)

    with open("data/image_size.json", "r") as file:
        image_size_dict = json.load(file)

    name = os.path.basename(task).split(".")[0]
    w, h = image_size_dict[name]
    r = 720 / h

    for k in list(labels.keys()):
        im = Image.open(k.replace("to_do", cat))
        w, h = im.size
        box = labels[k]
        new_box = []
        for b in box:
            bbox = np.array(b)
            bbox[::2] *= 1 / r
            bbox[1::2] *= 1 / r

            bbox = bbox.astype("int")
            new_box.append(list(bbox))

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
        normalize_labels(task)
        name = os.path.basename(task).split(".")[0]
        if name in task_status.keys():
            if task_status[name]["status"] != "done":
                task_status[name]["status"] = "done"
                task_status[name]["last_update"] = datetime.now().isoformat()

                s3.upload_file(task, bucket_name, task.split("data/")[1])
                backuped_task = task.replace("labels", "backup/labels")
                os.makedirs(os.path.dirname(backuped_task), exist_ok=True)
                shutil.move(task, backuped_task)

    done_tasks = glob.glob("data/labels/skip/*.json")
    for task in tqdm(done_tasks, desc="Upload skip tasks"):
        normalize_labels(task, cat="skip")
        name = os.path.basename(task).split(".")[0]
        if name in task_status.keys():
            if task_status[name]["status"] != "skip":
                task_status[name]["status"] = "skip"
                task_status[name]["last_update"] = datetime.now().isoformat()

                s3.upload_file(task, bucket_name, task.split("data/")[1])
                backuped_task = task.replace("labels", "backup/labels")
                os.makedirs(os.path.dirname(backuped_task), exist_ok=True)
                shutil.move(task, backuped_task)

    with open("data/task_status.json", "w") as file:
        json.dump(task_status, file)

    s3.upload_file("data/task_status.json", bucket_name, "task_status.json")

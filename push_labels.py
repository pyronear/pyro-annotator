import boto3
import os
from tqdm import tqdm
import glob
from datetime import datetime
import json


if __name__ == "__main__":
    bucket_name = "pyro-annotator"  # Change this to your bucket name

    s3 = boto3.client("s3")

    s3.download_file(bucket_name, "task_status.json", "data/task_status.json")
    with open("data/task_status.json", "r") as file:
        task_status = json.load(file)

    done_tasks = glob.glob("data/labels/done/*.json")
    for task in tqdm(done_tasks, desc="Upload done tasks"):
        name = os.path.basename(task).split(".")[0]
        if name in task_status.keys():
            if task_status[name]["status"] != "done":
                task_status[name]["status"] = "done"
                task_status[name]["last_update"] = datetime.now().isoformat()

                s3.upload_file(task, bucket_name, task.split("data/")[1])

    done_tasks = glob.glob("data/labels/skip/*.json")
    for task in tqdm(done_tasks, desc="Upload skip tasks"):
        name = os.path.basename(task).split(".")[0]
        if name in task_status.keys():
            if task_status[name]["status"] != "skip":
                task_status[name]["status"] = "skip"
                task_status[name]["last_update"] = datetime.now().isoformat()

                s3.upload_file(task, bucket_name, task.split("data/")[1])

    with open("data/task_status.json", "w") as file:
        json.dump(task_status, file)

    s3.upload_file("data/task_status.json", bucket_name, "task_status.json")

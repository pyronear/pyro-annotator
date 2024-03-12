import boto3
import os
import random
import argparse
from tqdm import tqdm
import botocore
import shutil
import json
from datetime import datetime


def download_folders(bucket_name, local_dir, n):
    s3 = boto3.client("s3")

    s3.download_file(bucket_name, "task_status.json", "data/task_status.json")
    with open("data/task_status.json", "r") as file:
        task_status = json.load(file)

    to_free = []
    for k, v in task_status.items():
        if v["status"] == "ongoing":
            t = datetime.strptime(v["last_update"].split(".")[0], "%Y-%m-%dT%H:%M:%S")
            dt = datetime.now() - t
            if dt.days > 15:  # free task after 15 days
                to_free.append(k)

    for task in selected_tasks:
        task_status[task]["status"] = "to_do"
        task_status[task]["last_update"] = datetime.now().isoformat()

    task_available = [k for k, v in task_status.items() if v["status"] == "to_do"]

    random.shuffle(task_available)
    selected_tasks = task_available[:n]
    print(f"There is {len(task_available)} fires availables ! Donwloading {n}")

    for task in selected_tasks:
        task_status[task]["status"] = "ongoing"
        task_status[task]["last_update"] = datetime.now().isoformat()

    with open("data/task_status.json", "w") as file:
        json.dump(task_status, file)

    s3.upload_file("data/task_status.json", bucket_name, "task_status.json")

    for task in tqdm(selected_tasks):

        folder = os.path.join("to_do", task)

        for obj in s3.list_objects_v2(Bucket=bucket_name, Prefix=folder)["Contents"]:
            file_name = obj["Key"]
            if not os.path.exists(os.path.dirname(local_dir + file_name)):
                os.makedirs(os.path.dirname(local_dir + file_name))
            s3.download_file(bucket_name, file_name, local_dir + file_name)
            # print(f"Downloaded {file_name} to {local_dir + file_name}")
            s3_embed_file = os.path.join(
                "embeddings", os.path.basename(file_name).split(".jpg")[0] + ".pth"
            )
            os.makedirs(os.path.dirname(local_dir + s3_embed_file), exist_ok=True)
            try:
                s3.download_file(bucket_name, s3_embed_file, local_dir + s3_embed_file)
            except botocore.exceptions.ClientError as e:
                if e.response["Error"]["Code"] == "404":
                    print(f"The file {s3_embed_file} does not exist in the bucket.")
                    shutil.rmtree(os.path.dirname(local_dir + file_name))
                    shutil.rmtree(os.path.dirname(local_dir + s3_embed_file))
                    break
                else:
                    raise  # Re-raise the exception if it's not a 404 error


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download folders from S3")
    parser.add_argument("n", type=int, default=10, help="Number of folders to download")
    args = parser.parse_args()

    bucket_name = "pyro-annotator"
    local_dir = "data/"
    print("downloading data ...")

    download_folders(bucket_name, local_dir, args.n)

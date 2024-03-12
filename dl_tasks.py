import boto3
import os
import random
import argparse
from tqdm import tqdm
import botocore
import shutil
import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image


def download_file(s3_client, bucket_name, s3_object_key, local_file_path):
    try:
        s3_client.download_file(bucket_name, s3_object_key, local_file_path)
        # Resize images
        if local_file_path[-3:] == "jpg":
            im = Image.open(local_file_path).resize((1280, 720))
            im.save(local_file_path)
    except botocore.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            print(f"The file {s3_object_key} does not exist.")
        else:
            raise


def download_folder(s3, bucket_name, prefix, local_dir):
    keys_to_download = []
    response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
    os.makedirs(os.path.join(local_dir, "embeddings"), exist_ok=True)
    if "Contents" in response:
        for obj in response["Contents"]:
            s3_object_key = obj["Key"]
            local_file_path = os.path.join(local_dir, s3_object_key)
            os.makedirs(os.path.dirname(local_file_path), exist_ok=True)
            keys_to_download.append((s3_object_key, local_file_path))
            # Download embeddings
            name = os.path.basename(s3_object_key).replace("jpg", "pth")
            embed_s3_object_key = os.path.join("embeddings", name)
            embed_local_file_path = os.path.join("data/embeddings", name)
            keys_to_download.append((embed_s3_object_key, embed_local_file_path))

    with ThreadPoolExecutor(max_workers=12) as executor:
        future_to_key = {
            executor.submit(download_file, s3, bucket_name, key, path): key
            for key, path in keys_to_download
        }
        for future in tqdm(as_completed(future_to_key), total=len(keys_to_download)):
            s3_object_key = future_to_key[future]
            try:
                data = future.result()
            except Exception as exc:
                print(f"There was an error downloading {s3_object_key}: {exc}")


def download_folders(bucket_name, local_dir, n):
    s3 = boto3.client("s3")
    os.makedirs("data", exist_ok=True)

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

    for task in list(task_status.keys()):
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
        download_folder(s3, bucket_name, os.path.join("to_do", task), local_dir)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download folders from S3")
    parser.add_argument("n", type=int, default=10, help="Number of folders to download")
    args = parser.parse_args()

    bucket_name = "pyro-annotator"
    local_dir = "data/"
    print("downloading data ...")

    download_folders(bucket_name, local_dir, args.n)

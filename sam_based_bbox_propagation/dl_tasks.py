import argparse
import glob
import json
import os
import pathlib
import random
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import boto3
import botocore
import numpy as np
from app.utils.utils import xywh2xyxy
from PIL import Image
from tqdm import tqdm


def download_file(s3_client, bucket_name, s3_object_key, local_file_path):
    try:
        s3_client.download_file(bucket_name, s3_object_key, local_file_path)
        # Resize images
        if local_file_path[-3:] == "jpg":
            im = Image.open(local_file_path)
            w, h = im.size
            r = 720 / h
            im.resize((int(r * w), 720)).save(local_file_path)
            return (w, h)
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
            os.makedirs(pathlib.Path(local_file_path).parent, exist_ok=True)
            keys_to_download.append((s3_object_key, local_file_path))
            # Download embeddings
            name = pathlib.Path(s3_object_key).name.replace("jpg", "pth")
            embed_s3_object_key = os.path.join("embeddings", name)
            embed_local_file_path = os.path.join("data/embeddings", name)
            keys_to_download.append((embed_s3_object_key, embed_local_file_path))

    key, path = keys_to_download[0]

    image_size = download_file(s3, bucket_name, key, path)
    folder = key.split("/")[1]

    if pathlib.Path("data/image_size.json").is_file():
        with open("data/image_size.json", "r") as file:
            image_size_dict = json.load(file)
    else:
        image_size_dict = {}

    image_size_dict[folder] = image_size

    with open("data/image_size.json", "w") as file:
        json.dump(image_size_dict, file)

    print(s3, bucket_name, key, path, image_size)

    with ThreadPoolExecutor(max_workers=12) as executor:
        future_to_key = {
            executor.submit(download_file, s3, bucket_name, key, path): key for key, path in keys_to_download
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

    for task in to_free:
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


def auto_labels():
    folders = glob.glob("data/to_do/*")
    folders.sort()

    weight = "data/legendary-field-19.pt"
    for folder in folders:
        name = folder.split("/")[-1]
        if pathlib.Path("data/image_size.json").is_file():
            with open("data/image_size.json", "r") as file:
                image_size_dict = json.load(file)

        image_size = image_size_dict[name]
        r = 720 / image_size[1]
        if not pathlib.Path(f"runs/{name}/").is_dir():
            cmd = f"yolo predict model={weight} conf=0.2 iou=0 source={folder} save=False save_txt save_conf name={name} project=runs verbose=False"
            print(f"* Command:\n{cmd}")
            subprocess.call(cmd, shell=True)
            label_files = glob.glob(f"runs/{name}/labels/*")
            w, h = int(image_size[0] * r), 720
            coeff = 0.05
            bbox_dict = {}
            for file_path in label_files:
                with open(file_path, "r") as file:
                    boxes = file.readlines()

                images_file = file_path.replace("runs", "data/to_do").replace("labels/", "").replace("txt", "jpg")
                bbox_dict[images_file] = []
                for box in boxes:
                    box = np.array(box.split(" "))[1:5].astype("float")
                    box[::2] *= w
                    box[1::2] *= h
                    box = xywh2xyxy(box)
                    box = [int(x) for x in box]

                    bbox_dict[images_file].append(box)

            auto_label_file = f"data/auto_labels/{name}.json"
            os.makedirs("data/auto_labels", exist_ok=True)
            with open(auto_label_file, "w") as file:
                json.dump(bbox_dict, file)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download folders from S3")
    parser.add_argument("n", type=int, default=10, help="Number of folders to download")
    args = parser.parse_args()

    bucket_name = "pyro-annotator"
    local_dir = "data/"
    print("downloading data ...")

    download_folders(bucket_name, local_dir, args.n)
    auto_labels()

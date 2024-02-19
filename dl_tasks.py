import boto3
import os
import random
import argparse


def download_folders(bucket_name, prefix, local_dir, n):
    s3 = boto3.client("s3")

    response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix, Delimiter="/")
    folders = [cp["Prefix"] for cp in response.get("CommonPrefixes", [])]

    random.shuffle(folders)
    selected_folders = folders[:n]

    for folder in selected_folders:

        for obj in s3.list_objects_v2(Bucket=bucket_name, Prefix=folder)["Contents"]:
            file_name = obj["Key"]
            if not os.path.exists(os.path.dirname(local_dir + file_name)):
                os.makedirs(os.path.dirname(local_dir + file_name))
            s3.download_file(bucket_name, file_name, local_dir + file_name)
            # print(f"Downloaded {file_name} to {local_dir + file_name}")
            s3_embed_file = os.path.join(
                "embeddings", os.path.basename(file_name).split(".jpg")[0] + ".pth"
            )
            s3.download_file(bucket_name, s3_embed_file, local_dir + s3_embed_file)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download folders from S3")
    parser.add_argument("n", type=int, default=10, help="Number of folders to download")
    args = parser.parse_args()

    bucket_name = "pyro-annotator"
    prefix = "to_do/"
    local_dir = "data/"
    print("downloading data ...")

    download_folders(bucket_name, prefix, local_dir, args.n)

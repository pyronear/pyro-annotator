import boto3
import os
import argparse


def move_s3_folder(bucket, source_folder, target_folder):
    s3 = boto3.resource("s3")
    bucket = s3.Bucket(bucket)

    # Copy each object from source_folder to target_folder
    for obj in bucket.objects.filter(Prefix=source_folder):
        old_source = {"Bucket": bucket.name, "Key": obj.key}
        # Target key is the object key with the source folder replaced by the target folder
        new_key = obj.key.replace(source_folder, target_folder, 1)
        s3.meta.client.copy(old_source, bucket.name, new_key)

        # Delete the original object
        obj.delete()


def upload_files(local_dir, bucket_name, s3_folder):
    s3 = boto3.client("s3")
    for subdir, dirs, files in os.walk(local_dir):
        for file in files:
            if file.startswith("."):  # Skip system files like .DS_Store on macOS
                continue

            full_path = os.path.join(subdir, file)
            with open(full_path, "rb") as data:
                file_path_s3 = os.path.join(
                    s3_folder, os.path.relpath(full_path, start=local_dir)
                )
                s3.upload_fileobj(data, bucket_name, file_path_s3)
                print(f"Uploaded {file} to s3://{bucket_name}/{file_path_s3}")

                parts = file_path_s3.split("/")
                if len(parts) > 2:
                    action = parts[1]
                    folder = parts[2].split(".")[0]
                    source_folder = os.path.join("to_do", folder)
                    target_folder = source_folder.replace("to_do", action)
                    move_s3_folder(bucket_name, source_folder, target_folder)
                else:
                    print("Error: Unexpected file path structure:", file_path_s3)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload label files to S3")
    args = parser.parse_args()

    local_dir = "data/labels/"
    bucket_name = "pyro-annotator"  # Change this to your bucket name
    s3_folder = "labels/"

    upload_files(local_dir, bucket_name, s3_folder)

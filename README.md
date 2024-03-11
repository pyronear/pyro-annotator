# Pyro-Annotator Usage Guide

## Getting Started

To begin annotating with Pyro-Annotator, follow these steps:

### 1. AWS Credentials
Request AWS credentials from Mateo to access necessary data.

### 2. Pulling Data
Use the `dl_tasks` script to download the data. You must specify the number of tasks to download:

```shell
python dl_tasks.py 5
```

Download Sam weights

```shell
wget https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth
```

### 3. Starting the Annotator
Launch the annotator tool with the following command:

```shell
make run
```

### 4. Pushing Labels
After annotation, push your labels back to the repository or designated storage.

```shell
make push
```

### 5. Make yolo dataset
After annotation, create a dataset with yolo annotation

```shell
python make_dataset.py
```

### 6. Observe resulting dataset using fiftyone
Observe the created dataset using fiftyone, you need to install fiftyone first 

```shell
pip install fiftyone
```

```shell
python run_fiftyone.py
```

## Additional Information

For any issues or further instructions, please refer to the documentation or contact the repository maintainer.

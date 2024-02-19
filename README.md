# Pyro-Annotator Usage Guide

## Getting Started

To begin annotating with Pyro-Annotator, follow these steps:

### 1. AWS Credentials
Request AWS credentials from Mateo to access necessary data.

### 2. Pulling Data
Use the `dl_tasks` script to download the data. You can specify the number of tasks to download:

```shell
python dl_tasks.py --num_tasks=<number_of_tasks>
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

## Additional Information

For any issues or further instructions, please refer to the documentation or contact the repository maintainer.

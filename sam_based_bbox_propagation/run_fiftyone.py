import glob
import pathlib

import fiftyone as fo

img_folder = "data/Dataset/images"

print(f"classify folder {img_folder}")

imgs = glob.glob(img_folder + "/*.jpg")
imgs.sort()


print("nb images :", len(imgs))

label_name = "smoke"
ds_name = "new_dl"

ds_list = fo.list_datasets()
for ds in ds_list:
    dataset = fo.load_dataset(ds)
    dataset.delete()

samples = []
for img_file in imgs:
    label_file = img_file.replace("images", "labels").replace(".jpg", ".txt")

    sample = fo.Sample(filepath=img_file)

    if pathlib.Path(label_file).is_file():
        with open(label_file) as f:
            lines = f.readlines()

        # Convert detections to FiftyOne format
        detections = []

        for line in lines:
            # Bounding box coordinates should be relative values
            # in [0, 1] in the following format:
            # [top-left-x, top-left-y, width, height]
            if len(line) > 0:
                bounding_box = [float(li) for li in line.split(" ")[1:5]]
                bounding_box[0] -= bounding_box[2] / 2
                bounding_box[1] -= bounding_box[3] / 2

                detections.append(fo.Detection(label="smoke", bounding_box=bounding_box))

        # Store detections in a field name of your choice
        sample[label_name] = fo.Detections(detections=detections)

    samples.append(sample)

dataset = fo.Dataset(ds_name)
dataset.add_samples(samples)
dataset.persistent = True


if __name__ == "__main__":
    # Ensures that the App processes are safely launched on Windows
    session = fo.launch_app(dataset)
    session.wait()

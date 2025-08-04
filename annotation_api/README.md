# Pyronear Annotation API

The building blocks of our annotations and model predictions as an API.

## Installation

### Prerequisites

- [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- [Docker](https://docs.docker.com/engine/install/)
- [Docker compose](https://docs.docker.com/compose/)

### Starting your service

#### 1 - Clone the repository

```bash
git clone https://github.com/pyronear/pyro-annotator.git && cd pyro-annotator
cd annotation_api
```

#### 2 - Setup and start the services

The setup is now automated! Simply run:

```bash
# For development (recommended)
make start

# For production
make start-prod

# Or run setup separately
make setup
```

The setup automatically:
- Creates the required `acme.json` file for Let's Encrypt certificates
- Sets proper file permissions (600)
- Checks prerequisites (Docker, Docker Compose)

#### 3 - Stop the services

```bash
# Stop development environment
make stop

# Stop production environment  
make stop-prod
```

#### 4 - Check what you've deployed

You can now access your backend API at [http://localhost:5050/docs](http://localhost:5050/docs)

#### Run the tests

```bash
make test
```

### Install locally

1. **Install `uv` with `pipx`:**

```bash
pipx install uv
```

2. **Install dependencies:**

```bash
uv sync
```

3. **Activate the `uv` virtual environment:**

```bash
source .venv/bin/activate
```

## Contributing

Any sort of contribution is greatly appreciated!

You can find a short guide in [`CONTRIBUTING`](CONTRIBUTING.md) to help grow this project!

## License

Distributed under the Apache 2.0 License. See [`LICENSE`](LICENSE) for more information.

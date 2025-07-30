# Pyronear API

The building blocks of our wildfire detection & monitoring API.

## Installation

### Prerequisites

- [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- [Docker](https://docs.docker.com/engine/install/)
- [Docker compose](https://docs.docker.com/compose/)

### Starting your service

#### 1 - Clone the repository

```bash
git clone https://github.com/pyronear/pyro-api.git && cd pyro-api
```
#### 2 - Set your environment variables

First copy the example environment setup
```bash
cp .env.template .env
```

Create an empty acme.json file:

```bash
touch acme.json
chmod 600 acme.json
```

#### 3 - Start the services

```bash
make run
make stop
```

#### 4 - Check how what you've deployed

You can now access your backend API at [http://localhost:5050/docs](http://localhost:5050/docs)

## More goodies

### Python client

This project is a REST-API, and you can interact with the service through HTTP requests. However, if you want to ease the integration into a Python project, take a look at our [Python client](client).

## Contributing

Any sort of contribution is greatly appreciated!

You can find a short guide in [`CONTRIBUTING`](CONTRIBUTING.md) to help grow this project!

## License

Distributed under the Apache 2.0 License. See [`LICENSE`](LICENSE) for more information.

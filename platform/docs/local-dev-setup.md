# Local Development Setup

## Overview

This guide explains how to set up the Provisr Platform development environment on your local machine.

---

## Prerequisites

Before getting started, ensure the following software is installed:

- Git
- Docker Desktop
- Go (latest stable version)
- GNU Make
- Visual Studio Code (recommended)

---

## Clone the Repository

Clone the project from GitHub and navigate into the project directory.

```bash
git clone https://github.com/The-Provisr/provisr-platform.git
cd provisr-platform
```

---

## Start the Database

The project currently uses PostgreSQL as its database.

Start the database using Docker Compose:

```bash
docker compose up -d
```

To verify that the container is running:

```bash
docker ps
```

You should see the PostgreSQL container running.

---

## Database Configuration

The default PostgreSQL configuration is:

| Setting | Value |
|----------|-------|
| Database | provisr |
| Username | postgres |
| Password | secret |
| Host | localhost |
| Port | 5433 |

---

## Database Migrations

Migration files are located in:

```text
db/migrations/
```

Current migration files:

```text
000001_init_schema.up.sql
000001_init_schema.down.sql
```

These files define the database schema for the project.

If a migration tool is added later (such as golang-migrate), run the migrations before starting the backend services.

---

## Build the Project

Build all Go modules and services by running:

```bash
make build
```

This command compiles the shared packages, protocol definitions, integration tests, and all backend services.

---

## Run Tests

Execute all project tests using:

    go test ./...

This command runs tests for all Go modules and backend services.

---

## Update Dependencies

After adding or updating Go packages, run:

    go work sync

This cleans and updates Go module dependencies across the project.

---

## Stop the Database

To stop the PostgreSQL container:

```bash
docker compose down
```

---

## Troubleshooting

### Docker is not running

Ensure Docker Desktop is running before executing Docker commands.

### PostgreSQL container fails to start

View the container logs:

```bash
docker compose logs postgres
```

### Port 5433 is already in use

Stop the application using port 5433 or update the port mapping in `docker-compose.yml`.

---

## Project Structure

    provisr-platform/
    ├── CONTRIBUTING.md
    ├── db/
    │   └── migrations/
    ├── docker-compose.yml
    ├── dockerfile
    ├── docs/
    ├── go.work
    ├── go.work.sum
    ├── pkg/
    ├── proto/
    ├── services/
    └── tests/

---

## Next Steps

After completing the local setup, developers can begin implementing services, running tests, and contributing to the Provisr Platform.
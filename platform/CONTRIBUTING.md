# Contributing to Provisr Platform

Thank you for contributing to the Provisr Platform! This document provides guidelines for setting up your development environment, following coding standards, and submitting contributions.

---

## Project Structure

The platform follows a microservices architecture. Each service is independently developed while sharing common libraries and configurations.

Key directories:

services/ - Individual backend microservices

pkg/ - Shared packages and utilities

proto/ - gRPC protocol definitions

db/ - Database migrations

docs/ - Project documentation

---

## Prerequisites

Before contributing, ensure you have installed:

- Git
- Docker Desktop
- Docker Compose
- Go (recommended version specified in go.mod)
- Visual Studio Code (recommended)

---

## Clone the Repository

git clone https://github.com/The-Provisr/provisr-platform.git

cd provisr-platform

---

## Start Development Environment

docker compose up --build

---

## Coding Guidelines

- Follow Go formatting standards (`go fmt`)
- Keep functions small and readable
- Use meaningful variable and function names
- Avoid duplicate code
- Write comments where business logic is complex

---

## Branch Naming

Use descriptive branch names.

Examples:

feature/login

feature/postman

feature/docs

bugfix/auth-token

hotfix/docker

---

## Commit Messages

Use clear commit messages.

Examples:

feat: add approval endpoint

docs: update local development guide

fix: resolve Docker build issue

test: add health integration tests

---

## Pull Requests

Before creating a Pull Request:

- Pull the latest changes
- Ensure Docker builds successfully
- Run tests
- Verify documentation
- Request review from teammates

---

## Reporting Issues

If you discover bugs:

- Describe the issue
- Include reproduction steps
- Attach screenshots or logs if applicable

---

## Thank You

Every contribution helps improve the Provisr Platform.
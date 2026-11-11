# Contributing to Fieldline

Thanks for your interest in contributing to Fieldline Equipment Operations.

## Getting started

1. Read the [README](README.md) for local setup instructions.
2. Search existing GitHub issues before opening a new one.
3. For larger changes, open an issue first to discuss the proposed approach.
4. Fork the repository, create a focused branch, and make your changes.
5. Test your changes locally, then open a pull request against `main`.

## Development and testing

Fieldline has an Angular frontend in `Client/` and an ASP.NET Core backend in `Server/`. Follow the README to install dependencies, build the client, and run the server. Include reproduction steps for bug fixes and describe how you verified your changes. Add or update automated tests where practical.

## Pull requests

- Keep changes focused and explain their purpose.
- Describe any changes to APIs, data storage, or user-facing behavior.
- Update documentation for changed workflows.
- Avoid committing generated build artifacts, credentials, `.env` files, or real customer data.
- Be respectful and constructive in issues and reviews.

## Security and demo data

The demo API does not implement authentication. Do not deploy it with real customer data or expose sensitive information. If you discover a vulnerability, avoid posting exploit details or secrets in a public issue; contact the maintainer privately through GitHub where possible.

By contributing, you agree that your contributions will be distributed under the repository's MIT License.

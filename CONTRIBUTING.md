# Contributing to ovh-bill

First off, thank you for considering contributing to ovh-bill! It's people like you that make ovh-bill such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (command lines, configuration files)
- **Describe the behavior you observed and what you expected**
- **Include your environment** (Node.js version, OS, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description of the suggested enhancement**
- **Explain why this enhancement would be useful**
- **List any alternatives you've considered**

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main` for your changes:
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. **Make your changes** and commit them with clear messages:
   ```bash
   git commit -m "Add feature: description of the feature"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/my-new-feature
   ```
5. **Open a Pull Request** against the `main` branch

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests when relevant

## Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ovh-bill.git
   cd ovh-bill
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your credentials (see [README.md](README.md#configuration))

4. Test your changes:
   ```bash
   node index.js --from=2024-01-01 --verbose
   ```

## Style Guide

- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Add trailing commas in multiline objects/arrays
- Keep lines under 100 characters when possible

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing!

# :memo: mdcov

Generate coverage reports in markdown for GitHub PRs.

## Usage

In your workflow `.yml` file use the following step:

```yaml
- uses: kntng/mdcov@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    lcov-path: coverage/lcov.info
```

replacing `coverage/lcov.info` with the proper path to the coverage file.

Note this action requires additional permissions on the token to write to pull requests, so add the following:

```yaml
permissions:
  issues: write
  pull-requests: write
```

## Example

A simple example triggers on pull requests. It checks out the repository, runs coverage, then uses the action to write the report to the PR.

```yaml
name: Code Coverage

on:
  pull_request:
    paths:
      - "**/*.ts"
      - "**/*.js"
      - ".github/workflows/coverage.yml"

permissions:
  issues: write
  pull-requests: write

jobs:
  coverage:
    name: Run coverage
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Run coverage
        run: bun run coverage
      - uses: kntng/mdcov@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          lcov-path: coverage/lcov.info
```

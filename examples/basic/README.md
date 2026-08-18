# Basic Example

What it shows: measuring drift × viability for a single manifest, and reading
the quadrant.

## Run

```sh
# From the repo root, after `npm install && npm run build`:
node dist/cli.js check package.json          # two-axis table
node dist/cli.js check package.json --json    # machine-readable, for CI
node dist/cli.js chart package.json --out q.svg   # the quadrant chart

# depwatch picks the parser from the filename, so the same commands work for
# any supported ecosystem:
node dist/cli.js check go.mod                 # Go modules
node dist/cli.js check pyproject.toml         # Python (Poetry / uv)
node dist/cli.js check Dockerfile             # base-image age (pulse only)

# See every recognised file, generated from the code:
node dist/cli.js --help
```

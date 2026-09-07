# depwatch — drift and viability, plotted against each other.
#
# Every verb this repo exposes lives here; `make` on its own prints them,
# grouped, straight out of the `##` comments below. FC-GEN-057: the same eight
# verbs in every repo, each either wired or a declared no-op that says why.
# None of them exit 0 quietly.

EXT := extensions/vscode
# Arguments for `make run`, e.g. make run ARGS="check package-lock.json"
ARGS ?= --help
# The version the biome-ci hook checks with, so `make format` and the gate
# cannot disagree about what formatted looks like.
BIOME_VERSION := 2.5.7
# Read rather than hard-coded: vsce names the VSIX after the version in the
# manifest, so a release bump must not turn ext-install into "file not found".
EXT_VERSION := $(shell node -p "require('./$(EXT)/package.json').version" 2>/dev/null)
VSIX := $(EXT)/depwatch-vscode-$(EXT_VERSION).vsix

.DEFAULT_GOAL := help
# help is pure output; the recipe echo would only be noise.
.SILENT: help

##@ General

.PHONY: help
help: ## Show this help
	awk 'BEGIN {FS = ":.*## "} \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } \
		/^[a-zA-Z_0-9-]+:.*## / { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

.PHONY: setup
setup: ## Install the pre-commit hook
	pre-commit install

# npm ci, not npm install: it installs exactly package-lock.json and fails if
# the lockfile and package.json disagree, which is what CI does.
.PHONY: install
install: ## Install the dependencies from the lockfile
	npm ci

##@ Build

.PHONY: build
build: ## Build the project
	npm run build

.PHONY: run
run: build ## Run the CLI from the build (make run ARGS="check <manifest>")
	node dist/cli.js $(ARGS)

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf dist $(EXT)/dist $(EXT)/*.vsix $(EXT)/CHANGELOG.md

##@ Quality

.PHONY: lint
lint: ## Run all pre-commit checks on the whole tree
	pre-commit run --all-files

.PHONY: typecheck
typecheck: ## Type-check without emitting (catches a half-added ecosystem)
	npm run typecheck

.PHONY: test
test: ## Run the tests
	npm test

# biome-ci in the gate checks the formatting; this is the same binary, same
# version, writing instead of complaining.
.PHONY: format
format: ## Format the tree with biome, the formatter the gate checks
	npx --yes @biomejs/biome@$(BIOME_VERSION) format --write .

.PHONY: analyze
analyze: ## Scan the tree the way CI does — vulnerabilities, misconfig, secrets
	@command -v trivy >/dev/null 2>&1 || { \
		echo "analyze needs trivy: https://trivy.dev/latest/getting-started/installation/" >&2; \
		exit 69; }
	trivy fs --scanners vuln,misconfig,secret --severity CRITICAL,HIGH .

# Not part of `make lint` or CI on purpose: a wall-clock number from a shared
# runner measures the runner. The checks that guard performance are the counting
# ones in the test suite (the request budget, the cache caps); this is the tool
# for when one of those moves and you want to know where the time went.
.PHONY: bench
bench: ## Run the performance benchmarks
	npx vitest bench --run

# The chart is the artefact worth committing, not the raw timings — so the JSON
# is a shell-local temp file. Made inside the recipe, not in a `:=` variable:
# that would run mktemp on every make invocation, `make help` included.
.PHONY: bench-chart
bench-chart: ## Re-run the benchmarks and redraw docs/performance.svg
	tmp=$$(mktemp -t depwatch-bench-XXXXXX.json); \
		trap 'rm -f "$$tmp"' EXIT; \
		npx vitest bench --run --outputJson="$$tmp" && \
		node scripts/bench-chart.mjs "$$tmp" docs/performance.svg

##@ VS Code extension

# The same four extension verbs, with the same meanings, in gandalf, greenlint
# and depwatch: build compiles, package writes the .vsix, install side-loads it,
# publish pushes it to both marketplaces.
.PHONY: ext-build
ext-build: ## Compile the VS Code extension
	npm --prefix $(EXT) install
	npm --prefix $(EXT) run typecheck
	npm --prefix $(EXT) run build

# `npm run package` runs vscode:prepublish first — typecheck, tests, bundle, and
# the copy of the root CHANGELOG the Marketplace renders as a tab (gitignored
# here: there is one changelog, release-please's).
.PHONY: ext-package
ext-package: ext-build ## Build the VS Code extension into a .vsix
	npm --prefix $(EXT) run package

.PHONY: ext-install
ext-install: ext-package ## Build the VS Code extension and install it
	code --install-extension $(VSIX) --force
	@echo "installed — reload the VS Code window to activate it"

# Normally CI's business: publishing happens in publish-extension.yml, called by
# release.yml when release-please cuts a release. This is the manual escape
# hatch, and it needs VSCE_PAT and OVSX_PAT in the environment.
.PHONY: ext-publish
ext-publish: ext-package ## Publish the .vsix to both marketplaces
	cd $(EXT) && npm run publish -- --packagePath "$(notdir $(VSIX))"
	cd $(EXT) && npx --yes ovsx@1.1.1 publish "$(notdir $(VSIX))" -p "$$OVSX_PAT"

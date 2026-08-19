# depwatch — drift and viability, plotted against each other.
#
# Every verb this repo exposes lives here; `make` on its own prints them,
# grouped, straight out of the `##` comments below.

EXT := extensions/vscode
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

##@ Build

.PHONY: build
build: ## Build the project
	npm run build

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

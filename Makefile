# depwatch
.PHONY: help setup build test lint clean ext-build ext-package ext-install ext-publish

EXT := extensions/vscode
# Read rather than hard-coded: vsce names the VSIX after the version in the
# manifest, so a release bump must not turn ext-install into "file not found".
EXT_VERSION := $(shell node -p "require('./$(EXT)/package.json').version" 2>/dev/null)
VSIX := $(EXT)/depwatch-vscode-$(EXT_VERSION).vsix

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

setup: ## Install the pre-commit hook
	pre-commit install

lint: ## Run all pre-commit checks on the whole tree
	pre-commit run --all-files

build: ## Build the project
	npm run build

test: ## Run the tests
	npm test

# The same four extension verbs, with the same meanings, in gandalf, greenlint
# and depwatch: build compiles, package writes the .vsix, install side-loads it,
# publish pushes it to both marketplaces.
ext-build: ## Compile the VS Code extension
	npm --prefix $(EXT) install
	npm --prefix $(EXT) run typecheck
	npm --prefix $(EXT) run build

# `npm run package` runs vscode:prepublish first — typecheck, tests, bundle, and
# the copy of the root CHANGELOG the Marketplace renders as a tab (gitignored
# here: there is one changelog, release-please's).
ext-package: ext-build ## Build the VS Code extension into a .vsix
	npm --prefix $(EXT) run package

ext-install: ext-package ## Build the VS Code extension and install it
	code --install-extension $(VSIX) --force
	@echo "installed — reload the VS Code window to activate it"

# Normally CI's business: publishing happens in publish-extension.yml, called by
# release.yml when release-please cuts a release. This is the manual escape
# hatch, and it needs VSCE_PAT and OVSX_PAT in the environment.
ext-publish: ext-package ## Publish the .vsix to both marketplaces
	cd $(EXT) && npm run publish -- --packagePath "$(notdir $(VSIX))"
	cd $(EXT) && npx --yes ovsx@1.1.1 publish "$(notdir $(VSIX))" -p "$$OVSX_PAT"

clean: ## Remove build artifacts
	rm -rf dist $(EXT)/dist $(EXT)/*.vsix $(EXT)/CHANGELOG.md

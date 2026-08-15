# depwatch
.PHONY: help setup build test lint clean ext-build ext-package

EXT := extensions/vscode

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

ext-build: ## Build the VS Code extension
	npm --prefix $(EXT) install
	npm --prefix $(EXT) run typecheck
	npm --prefix $(EXT) run build

ext-package: ext-build ## Package the VS Code extension as a VSIX
	cd $(EXT) && npx @vscode/vsce package --no-dependencies

clean: ## Remove build artifacts
	rm -rf dist $(EXT)/dist $(EXT)/*.vsix

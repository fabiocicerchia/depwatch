# depwatch
.PHONY: help setup build test typecheck lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'

setup: ## Install the pre-commit hook
	pre-commit install

lint: ## Run all pre-commit checks on the whole tree
	pre-commit run --all-files

build: ## Build the project
	npm run build

typecheck: ## Type-check without emitting (catches a half-added ecosystem)
	npm run typecheck

test: ## Run the tests
	npm test

clean: ## Remove build artifacts
	@echo "nothing to clean"

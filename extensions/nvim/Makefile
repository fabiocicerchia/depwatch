# depwatch.nvim
#
# `make test` runs the specs headless, exactly as CI does.

NVIM ?= nvim
PLENARY ?= $(shell pwd)/.deps/plenary.nvim

.PHONY: help test deps lint clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

deps: $(PLENARY) ## Fetch plenary.nvim, the only test dependency

$(PLENARY):
	@mkdir -p $(dir $(PLENARY))
	git clone --depth 1 https://github.com/nvim-lua/plenary.nvim $(PLENARY)

test: deps ## Run the specs headless
	@PLENARY=$(PLENARY) $(NVIM) --headless --noplugin \
		-u tests/minimal_init.lua \
		-c "PlenaryBustedDirectory tests { minimal_init = 'tests/minimal_init.lua', sequential = true }"

# Loaded through tests/minimal_init.lua so `require('depwatch.…')` resolves to
# this checkout. Without it every module that requires a sibling "failed" here,
# whatever the code said. tests/ is left out: a spec is only loadable inside
# busted, which `make test` is for.
lint: ## Check the Lua parses
	@fail=0; for f in $$(find lua plugin -name '*.lua'); do \
		$(NVIM) --headless --noplugin -u tests/minimal_init.lua -c "luafile $$f" -c qa 2>&1 | grep -q . \
			&& { echo "FAIL $$f"; fail=1; } || true; \
	done; \
	[ $$fail -eq 0 ] && echo "ok" || exit 1

clean: ## Remove fetched test dependencies
	rm -rf .deps

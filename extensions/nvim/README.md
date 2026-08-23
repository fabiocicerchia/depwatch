# depwatch.nvim

Dependency drift (libyears) × viability, in Neovim.

`depwatch` measures every dependency manifest in your project on two axes and
plots one against the other: **drift** — how far behind you are, in libyears —
and **viability** — whether the project could even be caught up with. The
cross-product is four quadrants, and the interesting one is `Replace`: behind
*and* unmaintained, where the upgrade you need may never be written.

This plugin does not reimplement any of that. It runs the `depwatch` CLI and
renders what it reports, so the number in your editor and the number in CI come
from the same code.

```
  "express": "^4.16.0",     8.18 ly · Upgrade
  "request": "2.88.0",      1.51 ly · Replace
```

## Requirements

- Neovim **0.11+**
- the `depwatch` CLI on `PATH`, or pointed at by `cmd`
- [plenary.nvim](https://github.com/nvim-lua/plenary.nvim) — for `make test` only

`:checkhealth depwatch` confirms all of it.

## Install

The plugin lives in `extensions/nvim/` of the depwatch repository, so point your
manager at that subdirectory.

**lazy.nvim**

```lua
{
  'fabiocicerchia/depwatch',
  rtp = 'extensions/nvim',
  event = { 'BufReadPost package.json', 'BufReadPost Cargo.toml', 'BufReadPost requirements.txt' },
  cmd = { 'DepwatchScan', 'DepwatchScanAll', 'DepwatchReport' },
  opts = {},
}
```

**vim-plug**

```vim
Plug 'fabiocicerchia/depwatch', { 'rtp': 'extensions/nvim' }
```

```lua
require('depwatch').setup({})
```

`setup()` is optional — every command works on the defaults without it.

## Configuration

```lua
require('depwatch').setup({
  enabled = true,

  -- A list, so an interpreter can go in front of it:
  --   cmd = { 'node', '/path/to/depwatch/dist/cli.js' }
  cmd = { 'depwatch' },

  manifests = {
    'package.json', 'requirements.txt', 'Cargo.toml', 'composer.json',
    'Gemfile.lock', 'go.mod', 'pyproject.toml', 'pom.xml', 'bom.json',
  },
  exclude = {
    'node_modules', 'bower_components', 'vendor', 'dist', 'out', 'build',
    'target', '.venv', 'venv', '__pycache__', '.git',
  },
  max_manifests = 25,

  deep = false,          -- maintainers, funding, archived, last commit
  transitive = false,    -- score the whole tree, not just what you chose
  use_lock_file = true,  -- off, drift becomes an upper bound

  thresholds = {
    stale_libyears = 1,    -- above this, "behind"
    risky_viability = 0.5, -- below this, "fading"
  },

  -- The editor's copy of `depwatch check --ci`. nil disables a gate.
  gates = {
    max_libyears = nil,
    max_replace = nil,
  },

  scan = {
    on_startup = true,
    on_save = true,        -- never on a keystroke
    debounce_ms = 1500,
    refresh_minutes = 360, -- 0 turns the timer off
    timeout_ms = 120000,
  },

  diagnostics = {
    enabled = true,
    severity = {
      replace = vim.diagnostic.severity.WARN,
      upgrade = vim.diagnostic.severity.INFO,
      watch = vim.diagnostic.severity.INFO,
      healthy = false,   -- false publishes nothing for that quadrant
      degraded = false,
    },
  },

  virtual_text = {
    enabled = true,
    lenses = { 'replace', 'upgrade', 'watch' },
    prefix = '  ',
  },

  baseline = { path = '.depwatch-baseline.json' },
  trend = { max_points = 12 },
})
```

Every value is validated at `setup()`, so a wrong one is a message at startup
rather than a nil index inside a callback later.

## Commands

| Command | What it does |
| --- | --- |
| `:DepwatchScan` | Scan the manifest in the current buffer, or the project |
| `:DepwatchScanAll` | Scan every manifest in the project |
| `:DepwatchDeepScan` | Scan with maintainer / archived / last-commit signals |
| `:DepwatchReport` | The report, in a float — worst first, with the bottom line |
| `:DepwatchTrend` | Drift over the manifest's git history |
| `:DepwatchGates` | Check `gates` — the editor's copy of `--ci` |
| `:DepwatchFilter` | Pick a quadrant; its findings go to the quickfix list |
| `:DepwatchHover` | Explain the dependency under the cursor |
| `:DepwatchBaselineWrite` | Accept every current finding |
| `:DepwatchBaselineClear` | Delete the baseline |
| `:DepwatchCancel` | Stop the scans in flight |
| `:DepwatchLog` | What was run, and what came back |

## Statusline

```lua
require('lualine').setup({
  sections = { lualine_x = { { require('depwatch').statusline } } },
})
```

Reads `12.40 ly · 7` — total drift, and how many dependencies are work.

## Baselines

An old repository opens at 88 libyears and fifty-odd dependencies to address.
All of it is true and none of it is news, and a list that never empties is a
list people stop reading.

`:DepwatchBaselineWrite` records what today looks like; afterwards only what got
worse is reported — more drift than was accepted, **or a worse quadrant at the
same drift**, which is how "the maintainer walked away since you signed off"
surfaces.

It writes the same `.depwatch-baseline.json` that `depwatch check --accepted`
reads, so committing it gives CI and every editor one answer.

## Differences from the VS Code extension

The VS Code extension imports depwatch's TypeScript engine directly. Neovim
cannot, so this runs the CLI — everything below follows from that.

**Dropped**

| Setting | Why |
| --- | --- |
| `useEditorExcludes` | Neovim has no `files.exclude` / `search.exclude` to merge; `exclude` is the whole list |
| `cache.*` | The extension caches because it holds the engine in-process. The CLI is a fresh process per scan with no persistent cache — which is why scans are on save and on a slow timer, never on a keystroke |
| `concurrency` | Belongs to the engine; the CLI does not expose it |
| `badge` | No panel tab to put a count on — the statusline carries the same numbers |
| `setGitHubToken` | No OS keychain in Neovim. Set `$GITHUB_TOKEN`, which is what the CLI reads anyway |
| `clearCache` | Nothing to clear, per `cache.*` |
| `exportReport` / `exportChart` | Already CLI commands (`depwatch chart <manifest> --out q.svg`); wrapping them would only add a prompt |
| scope toggles, expand/collapse | The tree view they belong to does not exist here |

**Different**

- **Findings pane** → a float (`:DepwatchReport`) and the quickfix list (`:DepwatchFilter`).
- **Hover** → `:DepwatchHover`, on request, so it never competes with your LSP.
- **Inline drift** → virtual text at end of line. The VS Code extension does not do this.
- **Baseline** → works in CI too, because `depwatch check` learned `--accepted`. In VS Code it was editor-only.

Everything else has a documented equivalent; see `:help depwatch-configuration`.

## Development

```sh
make test    # specs, headless, exactly as CI runs them
make lint    # check every file parses
```

## License

Apache-2.0, with the rest of depwatch.

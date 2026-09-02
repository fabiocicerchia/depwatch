-- Which files are worth scanning, and where the project starts.
--
-- Discovery is a `vim.fs.find` over the project root rather than a walk of our
-- own, and the excludes are directory names rather than globs: a package.json
-- under node_modules is still a package.json, and there are forty thousand of
-- them.

local core = require('depwatch.core')

local M = {}

--- The project root, as every other Neovim tool would find it.
function M.root()
  return vim.fs.root(0, { '.git', '.hg', 'package.json', 'Cargo.toml', 'go.mod' }) or vim.uv.cwd()
end

--- How deep a path is, for the ordering below.
local function depth(path)
  return select(2, path:gsub('/', ''))
end

--- Manifests worth scanning, shallowest first: in a monorepo the root manifest
--- is the one someone means.
function M.manifests(cfg)
  local skip = {}
  for _, name in ipairs(cfg.exclude) do
    skip[name] = true
  end
  local wanted = {}
  for _, name in ipairs(cfg.manifests) do
    wanted[name] = true
  end

  local found = vim.fs.find(function(name, path)
    if not wanted[name] then
      return false
    end
    for segment in path:gmatch('[^/]+') do
      if skip[segment] then
        return false
      end
    end
    return true
  end, { path = M.root(), type = 'file', limit = cfg.max_manifests * 4 })

  table.sort(found, function(a, b)
    local da, db = depth(a), depth(b)
    if da ~= db then
      return da < db
    end
    return a < b
  end)
  return vim.list_slice(found, 1, cfg.max_manifests)
end

--- Is this a file we would scan? Matched on the basename: a lock file beside a
--- manifest is picked up by depwatch itself, so only manifests are listed.
function M.is_manifest(cfg, path)
  local base = core.basename(path)
  for _, name in ipairs(cfg.manifests) do
    if base == name then
      return true
    end
  end
  return false
end

return M

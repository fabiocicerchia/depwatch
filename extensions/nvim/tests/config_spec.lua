-- Defaults, the deep merge, and the validation that turns a typo into a message
-- rather than a nil index three seconds later inside a callback.

local config = require('depwatch.config')

describe('defaults', function()
  it('resolves without any options', function()
    local cfg = config.resolve()
    assert.equals(true, cfg.enabled)
    assert.same({ 'depwatch' }, cfg.cmd)
    assert.equals(1, cfg.thresholds.stale_libyears)
    assert.equals(0.5, cfg.thresholds.risky_viability)
    assert.equals('.depwatch-baseline.json', cfg.baseline.path)
  end)

  it('has a documented equivalent for every gate', function()
    local cfg = config.resolve()
    assert.is_nil(cfg.gates.max_libyears)
    assert.is_nil(cfg.gates.max_replace)
  end)
end)

describe('merging', function()
  it('keeps the sibling when one nested key is set', function()
    local cfg = config.resolve({ thresholds = { stale_libyears = 3 } })
    assert.equals(3, cfg.thresholds.stale_libyears)
    assert.equals(0.5, cfg.thresholds.risky_viability, 'the other threshold survives')
  end)

  it('replaces a list wholesale rather than merging into it', function()
    -- Half-merged lists are never what anyone means: someone naming three
    -- manifests wants three, not three plus the nine defaults.
    local cfg = config.resolve({ manifests = { 'package.json' } })
    assert.same({ 'package.json' }, cfg.manifests)
  end)

  it('carries through a key the defaults leave nil', function()
    local cfg = config.resolve({ gates = { max_libyears = 5 } })
    assert.equals(5, cfg.gates.max_libyears)
    assert.is_nil(cfg.gates.max_replace)
  end)

  it('lets a quadrant be silenced', function()
    local cfg = config.resolve({ diagnostics = { severity = { replace = false } } })
    assert.is_false(cfg.diagnostics.severity.replace)
    assert.equals(vim.diagnostic.severity.INFO, cfg.diagnostics.severity.upgrade)
  end)
end)

describe('validation', function()
  local function fails(opts)
    local ok, err = pcall(config.resolve, opts)
    assert.is_false(ok, 'expected this to be rejected')
    return tostring(err)
  end

  it('rejects an empty cmd, which would otherwise fail per scan', function()
    assert.is_truthy(fails({ cmd = {} }):match('cmd'))
    assert.is_truthy(fails({ cmd = 'depwatch' }):match('cmd'))
  end)

  it('rejects a viability threshold outside 0..1', function()
    assert.is_truthy(fails({ thresholds = { risky_viability = 2 } }):match('risky_viability'))
  end)

  it('rejects a severity that is not one', function()
    assert.is_truthy(fails({ diagnostics = { severity = { replace = 'warning' } } }):match('severity'))
  end)

  it('rejects a trend sample size that cannot draw a line', function()
    assert.is_truthy(fails({ trend = { max_points = 1 } }):match('max_points'))
  end)

  it('rejects a max_manifests below one', function()
    assert.is_truthy(fails({ max_manifests = 0 }):match('max_manifests'))
  end)

  it('accepts the shapes it documents', function()
    assert.has_no.errors(function()
      config.resolve({
        cmd = { 'node', '/p/dist/cli.js' },
        gates = { max_libyears = 5, max_replace = 0 },
        diagnostics = { severity = { healthy = vim.diagnostic.severity.HINT } },
        scan = { on_save = false, refresh_minutes = 0 },
      })
    end)
  end)
end)

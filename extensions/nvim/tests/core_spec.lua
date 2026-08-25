-- The ported logic, tested without an editor: real manifests in, spans and
-- prose out.

local core = require('depwatch.core')

local function dep(over)
  return vim.tbl_extend('force', {
    name = 'left-pad',
    current = '1.1.0',
    latest = '1.3.0',
    resolved = true,
    libyearsBehind = 2.0,
    currentReleased = '2016-03-01T00:00:00.000Z',
    latestReleased = '2018-04-01T00:00:00.000Z',
    pulseYears = 6.5,
    viability = 0.2,
    quadrant = 'replace',
    signals = {},
  }, over or {})
end

local function report(deps, over)
  return vim.tbl_extend('force', {
    file = 'package.json',
    ecosystem = 'npm',
    generatedAt = '2026-01-01T00:00:00.000Z',
    totalLibyears = 2.0,
    deps = deps,
    worst = deps,
  }, over or {})
end

local THRESHOLDS = { stale_libyears = 1, risky_viability = 0.5 }

describe('the command line', function()
  local cfg = require('depwatch.config').resolve({})

  it('always asks for JSON and passes the thresholds through', function()
    assert.same(
      { 'check', '/p/package.json', '--json', '--stale', '1', '--risky', '0.5' },
      core.check_argv(cfg, '/p/package.json', {})
    )
  end)

  it('names a baseline only when the caller found one', function()
    -- `--accepted` pointing at a file that is not there is an error to the CLI,
    -- and having no baseline yet is the normal case.
    assert.is_false(vim.tbl_contains(core.check_argv(cfg, 'm', {}), '--accepted'))
    local argv = core.check_argv(cfg, 'm', { baseline = '/p/.depwatch-baseline.json' })
    assert.is_true(vim.tbl_contains(argv, '--accepted'))
    assert.is_true(vim.tbl_contains(argv, '/p/.depwatch-baseline.json'))
  end)

  it('asks for a deep scan per run as well as per config', function()
    assert.is_true(vim.tbl_contains(core.check_argv(cfg, 'm', { deep = true }), '--deep'))
    local deep_cfg = require('depwatch.config').resolve({ deep = true })
    assert.is_true(vim.tbl_contains(core.check_argv(deep_cfg, 'm', {}), '--deep'))
  end)

  it('passes --no-lock only when lock files are turned off', function()
    local off = require('depwatch.config').resolve({ use_lock_file = false })
    assert.is_true(vim.tbl_contains(core.check_argv(off, 'm', {}), '--no-lock'))
    assert.is_false(vim.tbl_contains(core.check_argv(cfg, 'm', {}), '--no-lock'))
  end)
end)

describe('reading a report', function()
  it('rejects anything that is not one', function()
    assert.is_false(core.is_report(nil))
    assert.is_false(core.is_report({}))
    assert.is_false(core.is_report({ deps = {}, totalLibyears = 'x', file = 'y' }))
    assert.is_true(core.is_report(report({})))
  end)

  it('orders worst-first, then by drift, then by name', function()
    local deps = {
      dep({ name = 'b', quadrant = 'healthy', libyearsBehind = 0 }),
      dep({ name = 'c', quadrant = 'upgrade', libyearsBehind = 3 }),
      dep({ name = 'a', quadrant = 'upgrade', libyearsBehind = 9 }),
      dep({ name = 'd', quadrant = 'replace', libyearsBehind = 1 }),
    }
    local sorted = core.sorted_deps(report(deps))
    assert.same({ 'd', 'a', 'c', 'b' }, vim.tbl_map(function(d)
      return d.name
    end, sorted))
  end)

  it('files a dependency with no registry data under its own lens', function()
    assert.equals('degraded', core.lens_of(dep({ degraded = 'registry HTTP 500', quadrant = 'healthy' })))
    assert.equals('replace', core.lens_of(dep()))
  end)
end)

describe('totals', function()
  it('counts what is actually work, and leaves out what is unknown', function()
    local totals = core.totals({
      report({
        dep({ name = 'a', quadrant = 'replace' }),
        dep({ name = 'b', quadrant = 'upgrade' }),
        dep({ name = 'c', quadrant = 'healthy' }),
        dep({ name = 'd', quadrant = 'healthy', degraded = 'no answer' }),
      }, { totalLibyears = 4.5 }),
    })
    assert.equals(4.5, totals.libyears)
    assert.equals(4, totals.deps)
    assert.equals(1, totals.degraded)
    -- The degraded one is not counted as healthy, and not counted as work.
    assert.equals(1, totals.counts.healthy)
    assert.equals(2, totals.to_address)
  end)

  it('adds up across manifests', function()
    local totals = core.totals({
      report({ dep({ name = 'a' }) }, { totalLibyears = 1.005 }),
      report({ dep({ name = 'b' }) }, { totalLibyears = 2.006 }),
    })
    assert.equals(3.01, totals.libyears)
    assert.equals(2, totals.deps)
  end)

  it('agrees with the noun it is counting', function()
    assert.equals('0.00 libyears', core.summary_label({ libyears = 0, deps = 0, to_address = 0, counts = {} }))
    assert.equals(
      '1.00 libyears · nothing to address',
      core.summary_label({ libyears = 1, deps = 3, to_address = 0, counts = {} })
    )
    assert.equals(
      '1.00 libyears · 1 of 1 dep to address',
      core.summary_label({ libyears = 1, deps = 1, to_address = 1, counts = {} })
    )
    assert.equals(
      '1.00 libyears · 2 of 3 deps to address',
      core.summary_label({ libyears = 1, deps = 3, to_address = 2, counts = {} })
    )
  end)
end)

describe('the gates', function()
  it('fails above the drift budget', function()
    local fails = core.gate_failures(report({}, { totalLibyears = 6 }), { max_libyears = 5 })
    assert.equals(1, #fails)
    assert.equals('max-libyears', fails[1].gate)
    assert.is_truthy(fails[1].message:match('6%.00 libyears exceeds'))
  end)

  it('does not fail at the budget', function()
    assert.same({}, core.gate_failures(report({}, { totalLibyears = 5 }), { max_libyears = 5 }))
  end)

  it('counts the replace quadrant, ignoring what it could not reach', function()
    local r = report({
      dep({ name = 'a', quadrant = 'replace' }),
      dep({ name = 'b', quadrant = 'replace' }),
      dep({ name = 'c', quadrant = 'replace', degraded = 'no answer' }),
    })
    assert.equals(0, #core.gate_failures(r, { max_replace = 2 }))
    assert.equals(1, #core.gate_failures(r, { max_replace = 1 }))
  end)

  it('says nothing when no gate is configured', function()
    assert.same({}, core.gate_failures(report({}, { totalLibyears = 99 }), {}))
  end)
end)

describe('saying why', function()
  it('summarises a finding in one line', function()
    local line = core.summarise(dep(), THRESHOLDS)
    assert.is_truthy(line:match('^left%-pad: Replace'))
    assert.is_truthy(line:match('2%.00 libyears behind'))
    assert.is_truthy(line:match('1%.1%.0 → 1%.3%.0'))
    assert.is_truthy(line:match('Behind means over 1 libyears'))
  end)

  it('does not score a dependency it could not reach', function()
    local line = core.summarise(dep({ degraded = 'not found in registry' }), THRESHOLDS)
    assert.equals('left-pad: no registry data (not found in registry) — not scored', line)
  end)

  it('gives the archived reason first, because nothing outvotes it', function()
    local reasons = core.reasons(dep({ signals = { archived = true, lastReleaseAgeDays = 9 } }))
    assert.is_truthy(reasons[1]:match('archived'))
  end)

  it('says a range is an upper bound', function()
    local reasons = table.concat(core.reasons(dep({ resolved = false })), '\n')
    assert.is_truthy(reasons:match('the real drift is this or lower'))
  end)

  it('offers a deep scan when only the timeline was available', function()
    local reasons = table.concat(core.reasons(dep({ signals = {} })), '\n')
    assert.is_truthy(reasons:match('run a deep scan'))
    local deep = table.concat(core.reasons(dep({ signals = { maintainerCount = 1 } })), '\n')
    assert.is_falsy(deep:match('run a deep scan'))
    assert.is_truthy(deep:match('one maintainer'))
  end)

  it('rounds the way a human reads time', function()
    assert.equals('less than a month', core.years(0.05))
    assert.equals('6 months', core.years(0.5))
    assert.equals('2.5 years', core.years(2.5))
  end)

  it('links to the registry it came from', function()
    assert.equals('https://www.npmjs.com/package/left-pad', core.registry_url('npm', 'left-pad'))
    assert.equals('https://crates.io/crates/serde', core.registry_url('cargo', 'serde'))
    assert.is_nil(core.registry_url('docker', 'alpine'))
  end)
end)

describe('grouping the report', function()
  local function scan(label, deps, over)
    return {
      path = '/p/' .. label,
      label = label,
      report = report(deps, vim.tbl_extend('force', { file = label }, over or {})),
    }
  end

  local healthy = dep({ name = 'ok', quadrant = 'healthy', libyearsBehind = 0.0, viability = 0.9 })
  local upgrade = dep({ name = 'behind', quadrant = 'upgrade', libyearsBehind = 3.0, viability = 0.9 })
  local replace = dep({ name = 'dead', quadrant = 'replace', libyearsBehind = 4.0 })
  local unknown = dep({ name = 'ghost', degraded = 'not found in registry' })

  local scans = {
    scan('api/package.json', { healthy, upgrade }),
    scan('web/Cargo.toml', { replace, unknown }, { ecosystem = 'cargo' }),
  }

  it('groups by file, one bucket per manifest', function()
    local groups = core.group_report(scans, 'file')
    assert.equals(2, #groups)
    assert.equals('api/package.json', groups[1].key)
    assert.equals('api/package.json  (npm)', groups[1].title)
    assert.equals(2, #groups[1].rows)
  end)

  -- A clean manifest is an answer, not an absence: dropping it would read as
  -- "not scanned" rather than "nothing to address".
  it('keeps a manifest with nothing in it, but only when grouping by file', function()
    local empty = { scan('tools/package.json', {}) }
    assert.equals(1, #core.group_report(empty, 'file'))
    assert.equals(0, #core.group_report(empty, 'file')[1].rows)
    assert.equals(0, #core.group_report(empty, 'severity'))
  end)

  it('groups by severity, worst quadrant first and unknown last', function()
    local groups = core.group_report(scans, 'severity')
    local keys = vim.tbl_map(function(g)
      return g.key
    end, groups)
    assert.same({ 'replace', 'upgrade', 'healthy', 'degraded' }, keys)
    assert.is_truthy(groups[1].title:match('^Replace — '))
  end)

  it('collects a severity from every manifest into one bucket', function()
    local both = core.group_report({ scan('a', { upgrade }), scan('b', { upgrade }) }, 'severity')
    assert.equals(1, #both)
    assert.equals(2, #both[1].rows)
    assert.equals('a', both[1].rows[1].scan.label)
    assert.equals('b', both[1].rows[2].scan.label)
  end)

  it('groups by ecosystem, alphabetically', function()
    local groups = core.group_report(scans, 'ecosystem')
    assert.same({ 'cargo', 'npm' }, vim.tbl_map(function(g)
      return g.key
    end, groups))
  end)

  -- An SBOM carries several ecosystems in one file, so the dep's own wins.
  it('prefers the dependency ecosystem over the manifest one', function()
    local mixed = { scan('bom.json', { dep({ name = 'serde', ecosystem = 'cargo' }), dep({ name = 'left-pad' }) }) }
    assert.same({ 'cargo', 'npm' }, vim.tbl_map(function(g)
      return g.key
    end, core.group_report(mixed, 'ecosystem')))
  end)

  it('falls back to file for a mode it does not know', function()
    assert.same(core.group_report(scans, 'file'), core.group_report(scans, 'rule'))
    assert.same(core.group_report(scans, 'file'), core.group_report(scans, nil))
  end)
end)

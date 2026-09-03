-- Saying why, in words.
--
-- A squiggle under a dependency name is only worth having if hovering it
-- explains itself. "viability 0.31" is not an explanation; "last release 3.4
-- years ago, one maintainer, repository archived" is. Every number here comes
-- from the report -- nothing is inferred that the engine did not measure.
--
-- No `vim.` calls: the whole module is testable under plain Lua.

local lens = require('depwatch.lens')

local M = {}

local function years(n)
  if n < 1 / 12 then
    return 'less than a month'
  end
  if n < 1 then
    return string.format('%d months', math.max(1, math.floor(n * 12 + 0.5)))
  end
  return string.format('%.1f years', n)
end

M.years = years

local function days(n)
  local whole = math.floor(n + 0.5)
  if whole < 45 then
    return string.format('%d days', whole)
  end
  if whole < 365 then
    return string.format('%d months', math.floor(whole / 30 + 0.5))
  end
  return string.format('%.1f years', whole / 365.25)
end

local function threshold_note(t)
  return string.format(
    'Behind means over %s libyears; fading means viability under %s.',
    tostring(t.stale_libyears),
    tostring(t.risky_viability)
  )
end

--- The one-line message that goes on the diagnostic.
function M.summarise(dep, thresholds)
  if dep.degraded then
    return string.format('%s: no registry data (%s) — not scored', dep.name, dep.degraded)
  end
  local bits = {
    string.format('%.2f libyears behind', dep.libyearsBehind),
    string.format('viability %.2f', dep.viability),
  }
  if dep.latest and dep.latest ~= dep.current then
    table.insert(bits, string.format('%s → %s', dep.current, dep.latest))
  end
  return string.format(
    '%s: %s — %s. %s. %s',
    dep.name,
    lens.LABEL[dep.quadrant],
    table.concat(bits, ', '),
    lens.BLURB[dep.quadrant],
    threshold_note(thresholds)
  )
end

local function bus_factor(count)
  if count <= 0 then
    return 'no maintainers listed'
  end
  if count == 1 then
    return '**one maintainer** — one person is one bus'
  end
  return string.format('%d maintainers', count)
end

--- One line each, in the order they appear in the hover: worst first, so the
--- reason someone should care is at the top rather than the bottom. Each
--- returns a line, or nil when the report has nothing to say on that point.
local REASONS = {
  function(dep, s)
    return s.archived and 'the repository is **archived** — the maintainer has said the project is over' or nil
  end,

  function(dep)
    if dep.libyearsBehind > 0 and dep.currentReleased and dep.latestReleased then
      return string.format(
        '**%.2f libyears behind**: %s shipped %s, %s shipped %s',
        dep.libyearsBehind,
        dep.current,
        dep.currentReleased:sub(1, 10),
        tostring(dep.latest),
        dep.latestReleased:sub(1, 10)
      )
    end
    if dep.latest == dep.current then
      return string.format('on the latest release (%s)', tostring(dep.latest))
    end
    return nil
  end,

  function(dep)
    return dep.pulseYears ~= nil and string.format('last release %s ago', years(dep.pulseYears)) or nil
  end,

  function(_, s)
    return s.lastCommitAgeDays ~= nil and string.format('last commit %s ago', days(s.lastCommitAgeDays)) or nil
  end,

  function(_, s)
    return s.releaseCadenceDays ~= nil and string.format('ships about every %s', days(s.releaseCadenceDays)) or nil
  end,

  function(_, s)
    return s.maintainerCount ~= nil and bus_factor(s.maintainerCount) or nil
  end,

  function(_, s)
    return s.hasFunding and 'has a funding channel' or nil
  end,

  function(dep)
    return dep.resolved == false
        and 'version read from a range, not a lock file — the real drift is this or lower'
      or nil
  end,

  function(_, s)
    if s.maintainerCount == nil and s.lastCommitAgeDays == nil and not s.archived then
      return 'scored from the release timeline only — run a deep scan for maintainers, archived status and last commit'
    end
    return nil
  end,
}

--- Everything the report knows about one dependency, worst first.
function M.reasons(dep)
  if dep.degraded then
    return { string.format('the registry did not answer for this package (%s)', dep.degraded) }
  end
  local out, signals = {}, dep.signals or {}
  for _, reason in ipairs(REASONS) do
    local line = reason(dep, signals)
    if line then
      out[#out + 1] = line
    end
  end
  return out
end

local REGISTRY_URL = {
  npm = 'https://www.npmjs.com/package/%s',
  pep440 = 'https://pypi.org/project/%s/',
  cargo = 'https://crates.io/crates/%s',
  composer = 'https://packagist.org/packages/%s',
  rubygems = 'https://rubygems.org/gems/%s',
}

function M.registry_url(ecosystem, name)
  local pattern = REGISTRY_URL[ecosystem]
  return pattern and pattern:format(name) or nil
end

--- The hover, as markdown lines.
function M.hover_lines(dep, thresholds, ecosystem)
  local head
  if dep.degraded then
    head = string.format('**%s** — not scored', dep.name)
  else
    local arrow = ''
    if dep.latest and dep.latest ~= dep.current then
      arrow = string.format(' → **%s**', dep.latest)
    end
    head = string.format('**%s** %s%s', dep.name, dep.current, arrow)
  end

  local badge
  if dep.degraded then
    badge = '`no data`'
  else
    badge = string.format(
      '`%s` drift **%.2f** ly · viability **%.2f**',
      lens.LABEL[dep.quadrant],
      dep.libyearsBehind,
      dep.viability
    )
  end

  local lines = { head, '', badge .. ' · ' .. lens.BLURB[lens.lens_of(dep)], '' }
  for _, reason in ipairs(M.reasons(dep)) do
    table.insert(lines, '- ' .. reason)
  end
  table.insert(lines, '')
  table.insert(lines, '_' .. threshold_note(thresholds) .. '_')

  local url = M.registry_url(dep.ecosystem or ecosystem, dep.name)
  if url then
    table.insert(lines, '')
    table.insert(lines, string.format('[%s on the registry](%s)', dep.name, url))
  end
  return lines
end

return M

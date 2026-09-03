-- The five lenses a dependency can be seen through, and what each is called.
--
-- Its own module because both core.lua and explain.lua need the words and
-- neither should have to require the other to get them.

local M = {}

M.QUADRANTS = { 'replace', 'upgrade', 'watch', 'healthy' }

--- Every quadrant, plus the pseudo-quadrant for deps the registry would not
--- answer for. A dep we could not reach is unknown, not unhealthy.
M.LENSES = { 'replace', 'upgrade', 'watch', 'healthy', 'degraded' }

M.LABEL = {
  replace = 'Replace',
  upgrade = 'Upgrade',
  watch = 'Watch',
  healthy = 'Healthy',
  degraded = 'no data',
}

M.BLURB = {
  replace = 'behind and unmaintained — the upgrade you need may never be written',
  upgrade = 'behind but alive — the newer version exists, it is just work',
  watch = 'current but fading — nothing to upgrade to yet, and nobody obviously shipping one',
  healthy = 'current, and maintained',
  degraded = 'the registry did not answer for these packages',
}

--- Which lens a dependency belongs under.
function M.lens_of(dep)
  if dep.degraded then
    return 'degraded'
  end
  return dep.quadrant
end

return M

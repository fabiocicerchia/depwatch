-- One prefix, one place. Every message the plugin shows says who it is from,
-- because a bare "no scan is running." in the message area belongs to nobody.

return function(message, level)
  vim.notify('depwatch: ' .. message, level or vim.log.levels.INFO)
end

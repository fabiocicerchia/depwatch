@domain:policy-gates @area:baselines @from:extensions/nvim
Feature: Accepting a baseline from the editor
  Lets a developer accept today's drift so that the editor, like CI, shows only what has got worse, using the same committed baseline file.

  Background:
    Given the project's baseline file is .depwatch-baseline.json at the project root

  @id:policy-gates.baselines.001 @rule:editor.baseline.applied-when-present @verified @source:extensions/nvim/lua/depwatch/init.lua#scan @test:extensions/nvim/tests/init_spec.lua#names --accepted on the command line only when the file is there
  Scenario Outline: Editor scans use the baseline when it exists and treat a missing one as normal
    Given the baseline file <presence>
    When the plugin scans package.json
    Then <effect>
    And no error about a missing baseline is shown

    Examples:
      | presence       | effect                                                                                        |
      | exists         | findings the baseline accepts are hidden, the same way `depwatch check --accepted` hides them |
      | does not exist | every finding is shown                                                                        |

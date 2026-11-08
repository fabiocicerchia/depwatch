@domain:editor-integration @area:editor-setup @from:extensions/nvim
Feature: Configuring and health-checking the Neovim plugin
  Helps a developer set the plugin up correctly and find out why scans produce nothing, by rejecting bad settings at setup and reporting what :checkhealth finds.

  Background:
    Given the depwatch plugin is installed in Neovim

  @id:editor-integration.editor-setup.001 @rule:editor.setup.commands-work-without-setup @inferred @source:extensions/nvim/plugin/depwatch.lua#ready
  Scenario: Commands work with default settings when setup was never called
    Given the developer's configuration never calls setup
    When the developer runs :DepwatchReport
    Then the plugin starts with its default settings
    And no error about missing configuration is shown

  @id:editor-integration.editor-setup.002 @rule:editor.health.missing-cli @verified @source:extensions/nvim/lua/depwatch/health.lua#check @test:extensions/nvim/tests/health_spec.lua#names the missing executable and how to point at a checkout
  Scenario: The health check names a missing depwatch and says how to point at a checkout
    Given cmd is set to depwatch-not-on-this-path, which is not installed
    When the developer runs :checkhealth depwatch
    Then it reports the error "`depwatch-not-on-this-path` is not executable"
    And its advice shows require('depwatch').setup({ cmd = { 'node', '/path/to/depwatch/dist/cli.js' } })

  @id:editor-integration.editor-setup.003 @rule:editor.health.cli-capabilities @verified @source:extensions/nvim/lua/depwatch/health.lua#check @test:extensions/nvim/tests/health_spec.lua#reports a binary that is there but will not run @test:extensions/nvim/tests/health_spec.lua#warns when something ran but is not depwatch @test:extensions/nvim/tests/health_spec.lua#warns about a build with no --accepted, because baselines will fail @test:extensions/nvim/tests/health_spec.lua#accepts help printed on stderr, which is where many CLIs put it
  Scenario Outline: The health check says whether the configured command runs, is depwatch, and supports baselines
    Given the configured command's help <help>
    When the developer runs :checkhealth depwatch
    Then it reports <result>

    Examples:
      | help                                                 | result                                                                                                 |
      | exits with status 3 and prints "boom" only on stderr | an error that the command did not run: boom                                                            |
      | prints "usage: ripgrep"                              | a warning that it does not look like depwatch                                                          |
      | mentions depwatch but not --accepted                 | that it runs, plus a warning that this build has no --accepted support and baseline commands will fail |
      | mentions depwatch and --accepted, on stderr          | that it runs and that this build supports --accepted                                                   |

  @id:editor-integration.editor-setup.004 @rule:editor.health.deep-without-token @verified @source:extensions/nvim/lua/depwatch/health.lua#check @test:extensions/nvim/tests/health_spec.lua#warns when deep is on without a token, and not when it is off @test:extensions/nvim/tests/health_spec.lua#stays quiet when a token is set
  Scenario Outline: The health check warns when deep scans are on without a GitHub token
    Given deep is <deep> and GITHUB_TOKEN is <token>
    When the developer runs :checkhealth depwatch
    Then the warning "deep scans are on but GITHUB_TOKEN is unset" is <shown>

    Examples:
      | deep | token | shown     |
      | on   | unset | shown     |
      | off  | unset | not shown |
      | on   | set   | not shown |

  @id:editor-integration.editor-setup.005 @rule:editor.health.project-status @verified @source:extensions/nvim/lua/depwatch/health.lua#check @test:extensions/nvim/tests/health_spec.lua#lists the manifests it found, relative to the root @test:extensions/nvim/tests/health_spec.lua#warns when the root holds no manifest, and points at the two settings @test:extensions/nvim/tests/health_spec.lua#says where it is not, which is the normal case @test:extensions/nvim/tests/health_spec.lua#says findings are hidden when one is there
  Scenario Outline: The health check reports the manifests and baseline it found in the project
    Given setup has run
    And the project root <manifests> and <baseline>
    When the developer runs :checkhealth depwatch
    Then it reports <manifest_result>
    And it reports <baseline_result>

    Examples:
      | manifests          | baseline                                     | manifest_result                                                                                | baseline_result                                            |
      | holds package.json | has no baseline file                         | "1 manifest(s): package.json"                                                                  | "baseline: none at .depwatch-baseline.json"                |
      | holds no manifest  | has accepted.json configured as the baseline | a warning that no dependency manifests were found, advising to check `manifests` and `exclude` | "baseline: accepted.json (findings it accepts are hidden)" |

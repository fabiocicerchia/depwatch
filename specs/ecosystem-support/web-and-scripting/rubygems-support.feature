@domain:ecosystem-support @area:web-and-scripting @from:ecosystems/rubygems
Feature: Measuring Ruby gem drift from Gemfile.lock
  Lets Ruby teams score the exact gem versions their Gemfile.lock pins, so drift and viability reflect what is actually installed.

  Background:
    Given a Ruby project with a Gemfile.lock

  @id:ecosystem-support.web-and-scripting.011 @rule:ecosystems.rubygems.gemfile-lock-is-recognised @verified @source:src/ecosystems/rubygems.ts#rubygems @test:src/manifest.test.ts#maps conventional manifest names @test:src/ecosystems/registry.test.ts#resolves files to the right ecosystem
  Scenario Outline: A Gemfile.lock is recognised as a RubyGems input
    Given the input file is named "<file>"
    When the operator checks the file without forcing an ecosystem
    Then the file is scored as the RubyGems ecosystem

    Examples:
      | file             |
      | Gemfile.lock     |
      | app/Gemfile.lock |

  @id:ecosystem-support.web-and-scripting.012 @rule:ecosystems.rubygems.pinned-spec-versions-are-exact @verified @source:src/ecosystems/rubygems.ts#parseGemfileLock @test:src/manifest.test.ts#reads pinned versions from Gemfile.lock specs, not its dependency lines @test:src/lockfile.test.ts#marks manifest versions unresolved and lock versions resolved
  Scenario: Gem versions come from the pinned specs and count as exact
    Given the lock's specs list "rails (7.1.3)" with a nested requirement "activesupport (= 7.1.3)"
    And the specs also list "activesupport (7.1.3)"
    And the DEPENDENCIES section lists "rails (~> 7.1)"
    When the operator checks the Gemfile.lock
    Then the report lists rails at 7.1.3 and activesupport at 7.1.3
    And both versions are treated as resolved, not as floors
    And the nested requirement and the DEPENDENCIES range add no extra entries

  @id:ecosystem-support.web-and-scripting.013 @rule:ecosystems.rubygems.gem-listed-once @inferred @source:src/ecosystems/rubygems.ts#parseGemfileLock
  Scenario: A gem pinned more than once is reported once, at its first pinned version
    Given the specs list "nokogiri (1.15.4-x86_64-linux)" followed by "nokogiri (1.15.4-arm64-darwin)"
    When the operator checks the Gemfile.lock
    Then the report lists nokogiri once, at version 1.15.4

  @id:ecosystem-support.web-and-scripting.014 @rule:ecosystems.rubygems.prerelease-reduced-to-release-number @inferred @source:src/ecosystems/rubygems.ts#parseGemfileLock @questionable
  Scenario: A pre-release gem pin is scored as its plain release number
    Given the specs list "rails (7.2.0.beta1)"
    When the operator checks the Gemfile.lock
    Then the report lists rails at version 7.2.0

  @id:ecosystem-support.web-and-scripting.015 @rule:ecosystems.rubygems.git-and-path-gems-scored-as-registry-gems @inferred @source:src/ecosystems/rubygems.ts#parseGemfileLock @questionable
  Scenario: Gems from git or local path sources are scored against RubyGems.org too
    Given the lock has a GIT section whose specs list "internal_tool (0.3.0)"
    And the lock has a GEM section whose specs list "rake (13.0.6)"
    When the operator checks the Gemfile.lock
    Then the report lists both internal_tool at 0.3.0 and rake at 13.0.6
    And internal_tool is looked up on RubyGems.org like any other gem

  @id:ecosystem-support.web-and-scripting.016 @rule:ecosystems.rubygems.deep-metadata @inferred @source:src/ecosystems/rubygems.ts#rubygems @questionable
  Scenario Outline: Deep metadata for a gem gives its repository but no maintainer count or funding
    Given the operator has requested deep viability signals
    And RubyGems.org lists the gem's source code URI as <source> and its homepage as <homepage>
    When the operator checks the Gemfile.lock
    Then the gem's repository is <repo>
    And the gem's maintainer count is unknown
    And the gem is reported as having no funding

    Examples:
      | source                            | homepage                   | repo                              |
      | https://github.com/example/widget | https://widget.example.com | https://github.com/example/widget |
      | absent                            | https://widget.example.com | https://widget.example.com        |
      | absent                            | absent                     | none                              |

  @id:ecosystem-support.web-and-scripting.017 @rule:ecosystems.rubygems.gem-purl-maps-to-rubygems @verified @source:src/ecosystems/rubygems.ts#rubygems @test:src/ecosystems/registry.test.ts#maps PURL types
  Scenario: SBOM components with a gem package URL are scored as RubyGems
    Given an SBOM lists a component with package URL "pkg:gem/rails@7.1.3"
    When the operator checks the SBOM
    Then the component is scored as rails 7.1.3 in the RubyGems ecosystem

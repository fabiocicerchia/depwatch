@domain:ecosystem-support @area:web-and-scripting @from:ecosystems/composer
Feature: Measuring PHP Composer dependencies
  Lets PHP teams point depwatch at composer.json or composer.lock and get drift and viability for their Packagist packages.

  Background:
    Given a PHP project managed with Composer

  @id:ecosystem-support.web-and-scripting.001 @rule:ecosystems.composer.lock-versions-exact @verified @source:src/ecosystems/composer.ts#parseComposerLock @test:src/lockfile.test.ts#reads exact versions from composer.lock, including dev
  Scenario: composer.lock yields the exact installed version of every runtime and dev package
    Given a composer.lock listing "monolog/monolog" at "3.5.2" under packages
    And the same lock listing "phpunit/phpunit" at "v10.5.1" under packages-dev
    When the operator checks the composer.lock
    Then "monolog/monolog" is measured at installed version "3.5.2", marked as resolved
    And "phpunit/phpunit" is measured at installed version "10.5.1", marked as resolved

  @id:ecosystem-support.web-and-scripting.002 @rule:ecosystems.composer.lock-preferred-over-manifest @verified @source:src/ecosystems/composer.ts#composer @test:src/lockfile.test.ts#finds Cargo.lock and composer.lock
  Scenario: A composer.lock next to composer.json is measured instead of the manifest
    Given a project folder containing composer.json and composer.lock
    When the operator checks the composer.json
    Then the report is built from composer.lock

  @id:ecosystem-support.web-and-scripting.003 @rule:ecosystems.composer.manifest-range-floor @verified @source:src/ecosystems/composer.ts#parseComposerJson @test:src/manifest.test.ts#ignores the package version and platform requirements
  Scenario: composer.json measures each Packagist package from the floor of its constraint and skips platform requirements
    Given a composer.json requiring "php" ">=8.1", "ext-json" "*" and "monolog/monolog" "^3.5.0"
    When the operator checks the composer.json with lock files disabled
    Then only "monolog/monolog" is measured
    And its installed version is taken as "3.5.0", marked as unresolved
    And "php" and "ext-json" do not appear in the report

  @id:ecosystem-support.web-and-scripting.004 @rule:ecosystems.composer.manifest-constraint-without-floor-omitted @inferred @source:src/ecosystems/composer.ts#parseComposerJson @questionable
  Scenario Outline: A composer.json package whose constraint has no major.minor version is left out of the report
    Given a composer.json requiring "<package>" at "<constraint>"
    When the operator checks the composer.json with lock files disabled
    Then "<package>" does not appear in the report
    And no warning about "<package>" is shown

    Examples:
      | package           | constraint |
      | symfony/console   | *          |
      | acme/widgets      | dev-main   |
      | guzzlehttp/guzzle | ^7         |

  @id:ecosystem-support.web-and-scripting.005 @rule:ecosystems.composer.unreadable-file-yields-no-dependencies @inferred @source:src/ecosystems/composer.ts#parseComposerLock @questionable
  Scenario: A composer file that is not valid JSON is reported as having no dependencies
    Given a composer.json or composer.lock whose content is not valid JSON
    When the operator checks that file
    Then the report lists no dependencies
    And no parse error is shown

  @id:ecosystem-support.web-and-scripting.006 @rule:ecosystems.composer.deep-metadata-from-packagist @inferred @source:src/ecosystems/composer.ts#composer
  Scenario: Deep checks read a Composer package's repository, maintainer count and funding from Packagist
    Given Packagist lists "monolog/monolog" with repository "https://github.com/Seldaek/monolog", 1 maintainer and 1 funding entry
    When the operator runs a deep check of a Composer project that depends on "monolog/monolog"
    Then the package's repository is "https://github.com/Seldaek/monolog"
    And its maintainer count is 1
    And it is marked as funded

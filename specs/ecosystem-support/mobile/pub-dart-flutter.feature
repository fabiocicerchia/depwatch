@domain:ecosystem-support @area:mobile @from:ecosystems/pub
Feature: Measuring Dart and Flutter dependencies from pub.dev
  Lets Dart and Flutter teams score their pubspec dependencies for drift and viability against pub.dev release history.

  Background:
    Given the pub.dev registry publishes every version of a package with its publish date

  @id:ecosystem-support.mobile.006 @rule:pub.lockfile.exact-pinned-versions @verified @source:src/ecosystems/pub.ts#parsePubspecLock @test:src/ecosystems/phase3.test.ts#reads pubspec.lock exact versions
  Scenario: A pubspec.lock reports every locked package at its exact pinned version
    Given a pubspec.lock locking "http" at 1.2.0 as a direct dependency
    And the same lock locking "meta" at 1.12.0 as a transitive dependency
    When the developer checks the pubspec.lock
    Then the manifest is recognised as the pub ecosystem
    And "http" is reported at installed version 1.2.0 as a resolved version
    And "meta" is reported at installed version 1.12.0 as a resolved version

  @id:ecosystem-support.mobile.007 @rule:pub.lockfile.non-hosted-packages-included @inferred @source:src/ecosystems/pub.ts#parsePubspecLock @questionable
  Scenario: Locked SDK, path and git packages are still reported as pub packages
    Given a pubspec.lock that locks "flutter" from the Flutter SDK at version 0.0.0
    When the developer checks the pubspec.lock
    Then "flutter" is listed as a dependency at installed version 0.0.0
    And its drift is looked up on pub.dev like any hosted package

  @id:ecosystem-support.mobile.008 @rule:pub.manifest.range-lower-bound @verified @source:src/ecosystems/pub.ts#parsePubspecYaml @test:src/ecosystems/phase3.test.ts#reads pubspec.yaml ranges and skips sdk deps
  Scenario Outline: A pubspec.yaml constraint is reported at its lowest allowed version
    Given a pubspec.yaml that declares "<package>" as "<constraint>" under <section>
    When the developer checks the pubspec.yaml
    Then "<package>" is reported at installed version <installed>
    And the version is marked as not resolved from a lock

    Examples:
      | package | constraint      | section          | installed |
      | http    | ^1.2.0          | dependencies     | 1.2.0     |
      | test    | >=1.24.0 <2.0.0 | dev_dependencies | 1.24.0    |

  @id:ecosystem-support.mobile.009 @rule:pub.manifest.non-registry-deps-skipped @verified @source:src/ecosystems/pub.ts#parsePubspecYaml @test:src/ecosystems/phase3.test.ts#reads pubspec.yaml ranges and skips sdk deps
  Scenario: SDK, path and git dependencies in a pubspec.yaml are not scored
    Given a pubspec.yaml that declares "flutter" as an SDK dependency
    And the same pubspec.yaml declares "http" as "^1.2.0"
    When the developer checks the pubspec.yaml
    Then "flutter" does not appear in the report
    And only "http" is listed as a dependency

  @id:ecosystem-support.mobile.010 @rule:pub.manifest.duplicate-declaration-first-wins @inferred @source:src/ecosystems/pub.ts#parsePubspecYaml
  Scenario: A package declared in both dependencies and dev_dependencies is reported once
    Given a pubspec.yaml that declares "http" as "^1.2.0" under dependencies
    And the same pubspec.yaml declares "http" as "^1.1.0" under dev_dependencies
    When the developer checks the pubspec.yaml
    Then "http" is listed once
    And "http" is reported at installed version 1.2.0

  @id:ecosystem-support.mobile.011 @rule:pub.registry.version-history-from-pub-dev @inferred @source:src/ecosystems/pub.ts#pub
  Scenario: Release dates for a pub package come from pub.dev
    Given pub.dev lists "http" versions 1.2.0 published 2024-01-10 and 1.2.2 published 2024-07-01
    When the developer checks a pubspec.lock that pins "http" at 1.2.0
    Then "http" shows latest version 1.2.2
    And "http" drift is measured from 2024-01-10 to 2024-07-01

  @id:ecosystem-support.mobile.012 @rule:pub.metadata.repository-and-funding @inferred @source:src/ecosystems/pub.ts#pub @questionable
  Scenario: Deep metadata for a pub package reports its repository and funding but no maintainer count
    Given the latest pubspec of "http" on pub.dev has no repository but has homepage "https://github.com/example/http"
    And that pubspec lists no funding links
    When the developer runs a deep check on a manifest that uses "http"
    Then "http" repository is https://github.com/example/http
    And "http" is reported as having no funding
    And "http" maintainer count is unknown

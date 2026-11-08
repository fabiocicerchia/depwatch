@domain:ecosystem-support @area:systems-languages @from:ecosystems/go
Feature: Measuring Go module dependencies
  Lets Go teams point depwatch at a go.mod and get drift for the exact module versions their build selects, with a clear refusal when they point at the wrong file.

  Background:
    Given the Go module proxy is reachable

  @id:ecosystem-support.systems-languages.006 @rule:ecosystems.go.go-mod-requires-are-exact-versions @verified @source:src/ecosystems/go.ts#parseGoMod @test:src/lockfile.test.ts#finds the requires in go.mod even with a go.sum beside it @test:src/ecosystems/phase4.test.ts#reads require blocks and single requires, dropping // indirect
  Scenario: Every require in go.mod is scored at its exact version
    Given a go.mod with a one-line require for "golang.org/x/tools v0.49.0"
    And and a require block listing "golang.org/x/mod v0.39.0" and "golang.org/x/sync v0.22.0"
    When the operator checks the go.mod
    Then the report lists golang.org/x/tools, golang.org/x/mod and golang.org/x/sync in that order
    And and each is reported at the version written in go.mod, treated as the installed version rather than a range

  @id:ecosystem-support.systems-languages.007 @rule:ecosystems.go.indirect-requires-are-scored @verified @source:src/ecosystems/go.ts#parseGoMod @test:src/ecosystems/phase4.test.ts#reads require blocks and single requires, dropping // indirect @questionable
  Scenario: Requires marked indirect are scored like direct ones
    Given a go.mod whose require block lists "golang.org/x/net v0.17.0 // indirect"
    When the operator checks the go.mod
    Then the report includes golang.org/x/net at v0.17.0
    And and nothing distinguishes it from a directly required module

  @id:ecosystem-support.systems-languages.008 @rule:ecosystems.go.go-sum-refused-with-reason @verified @source:src/ecosystems/go.ts#go @test:src/lockfile.test.ts#refuses go.sum with a reason instead of reporting zero dependencies @test:src/lockfile.test.ts#still recognises both files as Go
  Scenario: go.sum is refused with an explanation pointing to go.mod
    Given a go.sum holding checksum lines such as "golang.org/x/tools v0.49.0 h1:…"
    When the operator checks the go.sum
    Then it is recognised as a Go file, not reported as an unknown ecosystem
    And and the check fails with a message saying go.sum is a checksum database, not a version list
    And and the message tells the operator to point depwatch at go.mod
    And and no zero-dependency report is produced

  @id:ecosystem-support.systems-languages.009 @rule:ecosystems.go.go-mod-read-even-beside-go-sum @verified @source:src/ecosystems/go.ts#go @test:src/lockfile.test.ts#does not read go.sum in place of go.mod
  Scenario: A go.sum next to go.mod never replaces it as the input
    Given a project directory with both go.mod and go.sum
    When the operator checks the go.mod
    Then the file that gets read is go.mod, not go.sum
    And and the report lists the modules required in go.mod

  @id:ecosystem-support.systems-languages.010 @rule:ecosystems.go.pseudo-version-dated-by-commit-time @inferred @source:src/ecosystems/go.ts#pseudoDate
  Scenario: A pseudo-version's release date is the commit time it encodes
    Given a go.mod requiring "example.com/tool v0.0.0-20210101120000-abcdef123456"
    When the operator checks the go.mod
    Then the installed release date for example.com/tool is 2021-01-01T12:00:00Z
    And and the date does not depend on what the module proxy reports for that version

  @id:ecosystem-support.systems-languages.011 @rule:ecosystems.go.capitalised-module-paths-resolve @inferred @source:src/ecosystems/go.ts#escapeModule
  Scenario: Modules whose paths contain capital letters are still looked up
    Given a go.mod requiring "github.com/Azure/azure-sdk-for-go v68.0.0+incompatible"
    When the operator checks the go.mod
    Then the module's version history is found on the Go module proxy
    And and the module is scored rather than reported as unknown

  @id:ecosystem-support.systems-languages.012 @rule:ecosystems.go.replace-directives-ignored @inferred @source:src/ecosystems/go.ts#parseGoMod @questionable
  Scenario: Replace directives do not change the version that is scored
    Given a go.mod requiring "github.com/pkg/errors v0.9.1"
    And and a replace directive "github.com/pkg/errors => github.com/pkg/errors v0.8.0"
    When the operator checks the go.mod
    Then github.com/pkg/errors is reported at v0.9.1
    And and the replacement is not mentioned in the report

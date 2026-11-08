@domain:ecosystem-support @area:jvm-and-dotnet @from:ecosystems/nuget
Feature: Measuring drift of NuGet packages
  Lets .NET teams point depwatch at a project file, packages.config or packages.lock.json and see how far their NuGet packages lag behind nuget.org.

  Background:
    Given the NuGet registry at nuget.org is reachable

  @id:ecosystem-support.jvm-and-dotnet.008 @rule:nuget.manifests.recognised-files @verified @source:src/ecosystems/nuget.ts#nuget @test:src/ecosystems/phase3.test.ts#reads packages.lock.json resolved versions
  Scenario Outline: NuGet project, config and lock files are recognised as NuGet
    Given a project file named "<file>"
    When the operator checks the file
    Then the report's ecosystem is "nuget"

    Examples:
      | file               |
      | App.csproj         |
      | src/Api/Api.csproj |
      | packages.config    |
      | packages.lock.json |

  @id:ecosystem-support.jvm-and-dotnet.009 @rule:nuget.csproj.package-references @verified @source:src/ecosystems/nuget.ts#parseCsproj @test:src/ecosystems/phase3.test.ts#reads PackageReference from a .csproj (attribute and child forms)
  Scenario: A project file's package references are read with their requested versions
    Given a project file "App.csproj" referencing "Newtonsoft.Json" with a Version attribute "13.0.3"
    And it references "Serilog" with a nested Version element "3.1.1"
    When the operator checks the file
    Then "Newtonsoft.Json" is listed at version "13.0.3"
    And "Serilog" is listed at version "3.1.1"
    And both versions are marked as requested, not resolved

  @id:ecosystem-support.jvm-and-dotnet.010 @rule:nuget.csproj.version-floor @inferred @source:src/ecosystems/nuget.ts#parseCsproj @questionable
  Scenario Outline: A project file version range is measured from its lowest stated version, and a reference without a numeric version is left out
    Given a project file "App.csproj" referencing "Newtonsoft.Json" with version "<declared>"
    When the operator checks the file
    Then "Newtonsoft.Json" is <outcome>

    Examples:
      | declared             | outcome                    |
      | 13.0.3               | listed at version "13.0.3" |
      | [12.0.1,14.0)        | listed at version "12.0.1" |
      | 13.*                 | not listed                 |
      | $(NewtonsoftVersion) | not listed                 |

  @id:ecosystem-support.jvm-and-dotnet.011 @rule:nuget.config.exact-versions @inferred @source:src/ecosystems/nuget.ts#parsePackagesConfig
  Scenario: A packages.config lists each package at its pinned version
    Given a "packages.config" declaring package "Newtonsoft.Json" at version "13.0.3"
    When the operator checks the file
    Then "Newtonsoft.Json" is listed at version "13.0.3"
    And the version is marked as resolved

  @id:ecosystem-support.jvm-and-dotnet.012 @rule:nuget.lock.includes-transitive @verified @source:src/ecosystems/nuget.ts#parsePackagesLockJson @test:src/ecosystems/phase3.test.ts#reads packages.lock.json resolved versions @questionable
  Scenario: A NuGet lock file reports transitive packages even when only direct dependencies are requested
    Given a "packages.lock.json" that resolves direct package "Newtonsoft.Json" at "13.0.3"
    And it resolves transitive package "Serilog" at "3.1.1"
    When the operator checks the file without asking for transitive dependencies
    Then "Newtonsoft.Json" is listed at version "13.0.3"
    And "Serilog" is listed at version "3.1.1"
    And both versions are marked as resolved

  @id:ecosystem-support.jvm-and-dotnet.013 @rule:nuget.lock.unreadable-yields-nothing @inferred @source:src/ecosystems/nuget.ts#parsePackagesLockJson @questionable
  Scenario: An unreadable NuGet lock file yields no dependencies
    Given a "packages.lock.json" that is not valid JSON
    When the operator checks the file
    Then the check fails without a report
    And the error says "no dependencies found in packages.lock.json"

  @id:ecosystem-support.jvm-and-dotnet.014 @rule:nuget.registry.unlisted-versions-excluded @inferred @source:src/ecosystems/nuget.ts#nuget
  Scenario Outline: Unlisted NuGet versions do not count as releases and placeholder publish dates are treated as unknown
    Given nuget.org has a version "2.0.0" of "Contoso.Widgets" that is <listing> with publish date "<published>"
    When the operator checks a project depending on "Contoso.Widgets"
    Then version "2.0.0" is <treatment> in the package's release history

    Examples:
      | listing  | published            | treatment                       |
      | listed   | 2024-03-01T10:00:00Z | included, dated 2024-03-01      |
      | listed   | 1900-01-01T00:00:00Z | included without a release date |
      | unlisted | 2024-03-01T10:00:00Z | not included                    |

  @id:ecosystem-support.jvm-and-dotnet.015 @rule:nuget.metadata.repository-link @inferred @source:src/ecosystems/nuget.ts#nuget
  Scenario Outline: Deep metadata for a NuGet package gives its repository link and leaves maintainers unknown
    Given the newest nuget.org entry for "Contoso.Widgets" has <repository> and project URL "<project>"
    When the operator checks a project with deep metadata enabled
    Then <shown>
    And its maintainer count is unknown
    And it is not marked as funded

    Examples:
      | repository                                    | project                            | shown                                                                                        |
      | repository https://github.com/contoso/widgets | https://contoso.example.com        | its archived status and last commit are read from https://github.com/contoso/widgets         |
      | no repository                                 | https://github.com/contoso/widgets | its archived status and last commit are read from its project URL                            |
      | no repository                                 | https://contoso.example.com        | no GitHub archived status or last commit is added, because the project URL is not on GitHub |

@domain:in-editor-findings @area:dependency-location @from:src/locate
Feature: Pointing findings at the line that declares the dependency
  Developers need each finding underlined on the exact name that declared the dependency, so they can act on it without searching the manifest.

  Background:
    Given a workspace with a scanned manifest

  @id:vscode.in-editor-findings.dependency-location.001 @rule:findings.location.declared-name-in-supported-manifests @verified @source:extensions/vscode/src/locate.ts#locateDeps @test:extensions/vscode/src/locate.test.ts#finds names in every dependency section @test:extensions/vscode/src/locate.test.ts#reads composer.json require sections @test:extensions/vscode/src/locate.test.ts#reads requirements.txt, including extras and markers @test:extensions/vscode/src/locate.test.ts#reads Cargo.toml tables, including the [dependencies.name] form @test:extensions/vscode/src/locate.test.ts#reads Cargo.lock and Gemfile.lock
  Scenario Outline: A finding points at the dependency's name where the manifest declares it
    Given the manifest <file> declares <dependency> as `<declaration>`
    When a scan reports a finding for <dependency>
    Then the finding is underlined on the text "<dependency>" in that declaration

    Examples:
      | file             | dependency      | declaration                                   |
      | package.json     | react           | "dependencies": { "react": "^18.2.0" }        |
      | package.json     | vitest          | "devDependencies": { "vitest": "^4.0.0" }     |
      | composer.json    | phpunit/phpunit | "require-dev": { "phpunit/phpunit": "^10.5" } |
      | requirements.txt | django          | django[argon2]>=4.2 ; python_version >= "3.8" |
      | Cargo.toml       | tokio           | [dependencies] tokio = { version = "1.44" }   |
      | Cargo.toml       | regex           | [dependencies.regex]                          |
      | Cargo.lock       | serde           | name = "serde"                                |
      | Gemfile.lock     | activesupport   |     activesupport (7.1.3)                     |

  @id:vscode.in-editor-findings.dependency-location.002 @rule:findings.location.only-dependency-sections @verified @source:extensions/vscode/src/locate.ts#jsonSections @test:extensions/vscode/src/locate.test.ts#ignores keys outside the dependency sections
  Scenario: A name that also appears outside the dependency sections is pointed at in the dependency section
    Given package.json has a script named "react"
    And package.json declares "react": "^18.2.0" under dependencies
    When a scan reports a finding for react
    Then the finding is underlined on the line `"react": "^18.2.0"`
    And the script line is not underlined

  @id:vscode.in-editor-findings.dependency-location.003 @rule:findings.location.no-guess-for-undeclared @verified @source:extensions/vscode/src/locate.ts#locateDeps @test:extensions/vscode/src/locate.test.ts#says nothing about a dependency that is not written down @test:extensions/vscode/src/locate.test.ts#reads Cargo.toml tables, including the [dependencies.name] form
  Scenario Outline: A dependency the manifest does not declare is not underlined anywhere
    Given the manifest <file> does not declare <dependency>
    And the only other place "<dependency>" appears in the file is <elsewhere>
    When a scan reports a finding for <dependency>
    Then the finding is not underlined anywhere in <file>

    Examples:
      | file         | dependency | elsewhere          |
      | package.json | lodash     | nowhere            |
      | package.json | build      | a script name      |
      | Cargo.toml   | demo       | the [package] name |

  @id:vscode.in-editor-findings.dependency-location.004 @rule:findings.location.sbom-quoted-name @verified @source:extensions/vscode/src/locate.ts#fallback @test:extensions/vscode/src/locate.test.ts#falls back to the quoted name for an SBOM
  Scenario: In an SBOM or other unrecognised file a finding points at the dependency's quoted name
    Given the SBOM bom.json lists a component named "left-pad"
    When a scan reports a finding for left-pad
    Then the finding is underlined on the text "left-pad" inside its quotes

  @id:vscode.in-editor-findings.dependency-location.005 @rule:findings.location.no-partial-word-match @verified @source:extensions/vscode/src/locate.ts#fallback @test:extensions/vscode/src/locate.test.ts#refuses a partial word match @questionable
  Scenario: A finding is never underlined in the middle of another package's name
    Given the SBOM bom.json lists only a component named "left-pad"
    When a scan reports a finding for pad
    Then the finding is not underlined anywhere in bom.json

  @id:vscode.in-editor-findings.dependency-location.006 @rule:findings.location.python-name-spelling @inferred @source:extensions/vscode/src/locate.ts#normalise @questionable
  Scenario: A Python dependency is found even when the reported name differs in case or underscores
    Given requirements.txt declares `typing-extensions==4.12.0`
    When a scan reports a finding for Typing_Extensions
    Then the finding is underlined on the text "typing-extensions"

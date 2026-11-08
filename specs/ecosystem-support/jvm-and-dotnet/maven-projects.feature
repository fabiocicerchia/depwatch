@domain:ecosystem-support @area:jvm-and-dotnet @from:ecosystems/maven
Feature: Scoring Maven and Gradle projects
  Lets Java and Kotlin teams measure drift for the dependencies declared in pom.xml, Gradle build files and gradle.lockfile, using versions and release dates from Maven Central and Maven's own version ordering.

  @id:ecosystem-support.jvm-and-dotnet.001 @rule:maven.pom.reads-literal-versions @verified @source:src/ecosystems/maven.ts#parsePom @test:src/ecosystems/phase4.test.ts#reads pom.xml dependencies and skips property versions
  Scenario: A pom.xml contributes each dependency that has a literal version, once
    Given a pom.xml declares com.google.guava:guava at version 33.0.0-jre
    And it also declares org.example:managed at version ${managed.version}
    And it declares com.google.guava:guava a second time at version 31.0-jre
    When the operator checks the pom.xml
    Then the manifest is reported as a Maven Central manifest
    And com.google.guava:guava is listed once, at 33.0.0-jre, as a declared (not locked) version
    And org.example:managed is not listed

  @id:ecosystem-support.jvm-and-dotnet.002 @rule:maven.gradle.reads-string-coordinates @verified @source:src/ecosystems/maven.ts#parseGradle @test:src/ecosystems/phase4.test.ts#reads gradle declarations and the gradle.lockfile @questionable
  Scenario Outline: A Gradle build file contributes every quoted group:artifact:version coordinate
    Given a <file> declares implementation 'com.google.guava:guava:33.0.0-jre'
    And it declares api("org.slf4j:slf4j-api:2.0.9")
    And it declares implementation "org.example:lib:$libVersion"
    When the operator checks the <file>
    Then com.google.guava:guava is listed at 33.0.0-jre as a declared version
    And org.slf4j:slf4j-api is listed at 2.0.9 as a declared version
    And org.example:lib is not listed

    Examples:
      | file             |
      | build.gradle     |
      | build.gradle.kts |

  @id:ecosystem-support.jvm-and-dotnet.003 @rule:maven.gradle-lock.reads-exact-versions @verified @source:src/ecosystems/maven.ts#parseGradleLock @test:src/ecosystems/phase4.test.ts#reads gradle declarations and the gradle.lockfile
  Scenario: A gradle.lockfile contributes each locked coordinate at its exact version
    Given a gradle.lockfile locks com.google.guava:guava:33.0.0-jre=compileClasspath
    And it locks org.slf4j:slf4j-api:2.0.9=runtimeClasspath
    And it has a comment line and an empty= line
    When the operator checks the gradle.lockfile
    Then com.google.guava:guava is listed at 33.0.0-jre as a locked version
    And org.slf4j:slf4j-api is listed at 2.0.9 as a locked version
    And nothing is listed for the comment or the empty= line

  @id:ecosystem-support.jvm-and-dotnet.004 @rule:maven.versions.comparable-version-order @verified @source:src/ecosystems/maven.ts#mavenOps @test:src/ecosystems/phase4.test.ts#orders qualifiers and stable releases the Maven way
  Scenario Outline: Maven versions are ordered the way Maven orders them
    Given a Maven artifact has published versions <lower> and <higher>
    When the operator checks a manifest that depends on it
    Then <higher> is treated as the newer release

    Examples:
      | lower        | higher       |
      | r03          | 10.0         |
      | 10.0         | 33.0.0-jre   |
      | 33.0.0-jre   | 33.7.1-jre   |
      | 1.0-alpha    | 1.0-beta     |
      | 1.0-beta     | 1.0-rc1      |
      | 1.0-rc1      | 1.0-SNAPSHOT |
      | 1.0-SNAPSHOT | 1.0          |
      | 1.0          | 1.0-sp1      |

  @id:ecosystem-support.jvm-and-dotnet.005 @rule:maven.versions.prerelease-qualifiers @verified @source:src/ecosystems/maven.ts#mavenOps @test:src/ecosystems/phase4.test.ts#treats build qualifiers as stable and milestones as prerelease
  Scenario Outline: Milestones, candidates and snapshots are prereleases; build qualifiers are stable
    Given a Maven artifact has a published version <version>
    When the operator checks a manifest that depends on it
    Then <version> is classed as <kind>

    Examples:
      | version       | kind             |
      | 33.0.0-jre    | a stable release |
      | 2.0.0.RELEASE | a stable release |
      | 1.5.0.Final   | a stable release |
      | 1.0           | a stable release |
      | 1.0-SNAPSHOT  | a prerelease     |
      | 1.0-rc1       | a prerelease     |
      | 1.0-alpha1    | a prerelease     |
      | 1.0-M3        | a prerelease     |

  @id:ecosystem-support.jvm-and-dotnet.006 @rule:maven.versions.preview-ranks-after-release @inferred @source:src/ecosystems/maven.ts#rankOf @questionable
  Scenario Outline: An early-access or preview version ranks after the release it precedes
    Given a Maven artifact has published versions 1.0 and 1.0-<qualifier>
    When the operator checks a manifest that depends on it
    Then 1.0-<qualifier> is classed as a prerelease
    And 1.0-<qualifier> is treated as newer than 1.0

    Examples:
      | qualifier |
      | ea        |
      | preview   |
      | pre       |
      | dev       |

  @id:ecosystem-support.jvm-and-dotnet.007 @rule:maven.registry.dated-by-pom-publication @inferred @source:src/ecosystems/maven.ts#maven
  Scenario Outline: A Maven artifact's versions come from Maven Central and each release is dated by when its pom was published
    Given Maven Central lists versions 32.1.0-jre and 33.0.0-jre for <component>
    And the 33.0.0-jre pom on Maven Central was last modified on 2023-12-18
    When the operator checks a manifest naming <component>
    Then both versions are known for the artifact
    And 33.0.0-jre is dated 2023-12-18
    And a version whose pom gives no date is left undated

    Examples:
      | component              |
      | com.google.guava:guava |
      | com.google.guava/guava |

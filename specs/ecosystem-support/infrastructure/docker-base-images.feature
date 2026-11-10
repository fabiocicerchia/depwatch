@domain:ecosystem-support @area:infrastructure @from:ecosystems/docker
Feature: Tracking Docker base images
  Lets teams that ship containers see how old and how alive their Dockerfile base images are, without a misleading drift number for tags that have no version order.

  Background:
    Given the registry for Docker Hub images is reachable

  @id:ecosystem-support.infrastructure.001 @rule:ecosystems.docker.manifest-names-recognised @verified @source:src/ecosystems/docker.ts#docker @test:src/ecosystems/docker.test.ts#reads FROM images, resolving official names and skipping stages/scratch
  Scenario Outline: Dockerfiles and Containerfiles, with or without a suffix, are read as Docker manifests
    Given a project file named "<file>"
    When the operator checks the manifest
    Then the manifest is reported as the "docker" ecosystem

    Examples:
      | file              |
      | Dockerfile        |
      | Containerfile     |
      | Dockerfile.prod   |
      | containerfile.dev |

  @id:ecosystem-support.infrastructure.002 @rule:ecosystems.docker.base-image-reference-read @verified @source:src/ecosystems/docker.ts#parseDockerfile @test:src/ecosystems/docker.test.ts#reads FROM images, resolving official names and skipping stages/scratch @test:src/ecosystems/docker.test.ts#keeps a user/repo image and skips other registries and digest-only pins
  Scenario Outline: Each FROM base image is reported with its Docker Hub name and tag
    Given a Dockerfile containing the line "<from_line>"
    When the operator checks the manifest
    Then the dependency "<name>" is reported at version "<tag>"

    Examples:
      | from_line                             | name               | tag            |
      | FROM node:20.11.1-alpine AS build     | library/node       | 20.11.1-alpine |
      | FROM bitnami/postgresql:16            | bitnami/postgresql | 16             |
      | FROM --platform=linux/amd64 redis:7.2 | library/redis      | 7.2            |
      | FROM nginx                            | library/nginx      | latest         |
      | FROM nginx:1.27@sha256:aaaa           | library/nginx      | 1.27           |

  @id:ecosystem-support.infrastructure.003 @rule:ecosystems.docker.stages-and-scratch-not-dependencies @verified @source:src/ecosystems/docker.ts#parseDockerfile @test:src/ecosystems/docker.test.ts#reads FROM images, resolving official names and skipping stages/scratch
  Scenario: Build stages and scratch are not reported as base images
    Given a Dockerfile with "FROM node:20 AS build", "FROM scratch" and "FROM build AS final"
    When the operator checks the manifest
    Then only "library/node" is reported
    And neither "scratch" nor "build" appears as a dependency

  @id:ecosystem-support.infrastructure.004 @rule:ecosystems.docker.only-docker-hub-tagged-images-scored @verified @source:src/ecosystems/docker.ts#dockerHubImage @test:src/ecosystems/docker.test.ts#keeps a user/repo image and skips other registries and digest-only pins @questionable
  Scenario Outline: Images from other registries and digest-only pins are left out of the report
    Given a Dockerfile containing the line "<from_line>"
    When the operator checks the manifest
    Then no dependency is reported for that line
    And no warning is shown for it

    Examples:
      | from_line                                  |
      | FROM ghcr.io/owner/image:1.0               |
      | FROM quay.io/prometheus/prometheus:v2.50.0 |
      | FROM registry.example.com:5000/app:2       |
      | FROM localhost/app:dev                     |
      | FROM node@sha256:aaaa                      |

  @id:ecosystem-support.infrastructure.005 @rule:ecosystems.docker.repeated-image-reported-once @inferred @source:src/ecosystems/docker.ts#parseDockerfile @questionable
  Scenario: An image used in several FROM lines is reported once, at its first tag
    Given a Dockerfile with "FROM node:18" followed later by "FROM node:20"
    When the operator checks the manifest
    Then "library/node" is reported once
    And its version is "18"

  @id:ecosystem-support.infrastructure.006 @rule:ecosystems.docker.drift-unscored-pulse-from-current-tag @inferred @source:src/ecosystems/docker.ts#docker @questionable
  Scenario: A Docker image shows drift as unscored and its pulse as the age of the tag in use
    Given the Dockerfile uses "library/node" at tag "20.11.1-alpine"
    And that tag was last pushed one year ago
    When the operator checks the manifest
    Then the image's drift is shown as "—", not 0
    And no latest version is shown
    And its pulse is 1 year
    And it is placed in the healthy quadrant whatever its viability score

  @id:ecosystem-support.infrastructure.007 @rule:ecosystems.docker.unknown-tag-pulse-unknown @inferred @source:src/ecosystems/docker.ts#docker
  Scenario: A tag Docker Hub does not know leaves the image's pulse unknown
    Given the Dockerfile uses "library/node" at a tag that is not published on Docker Hub
    When the operator checks the manifest
    Then the image's pulse is shown as "—"
    And the image is still listed in the report

import { describe, expect, it } from 'vitest'
import { parse } from '../manifest.js'

describe('docker', () => {
  it('reads FROM images, resolving official names and skipping stages/scratch', () => {
    const m = parse(
      'Dockerfile',
      `FROM node:20.11.1-alpine AS build
WORKDIR /app
RUN npm ci

FROM scratch
FROM build AS final
FROM redis:7.2`,
    )
    expect(m.ecosystem).toBe('docker')
    expect(m.deps).toEqual([
      { name: 'library/node', current: '20.11.1-alpine', resolved: true },
      { name: 'library/redis', current: '7.2', resolved: true },
    ])
  })

  it('keeps a user/repo image and skips other registries and digest-only pins', () => {
    const m = parse(
      'Dockerfile.prod',
      `FROM bitnami/postgresql:16
FROM ghcr.io/owner/image:1.0
FROM quay.io/prometheus/prometheus:v2.50.0
FROM node@sha256:aaaa`,
    )
    // Only the Docker Hub tagged image survives.
    expect(m.deps).toEqual([{ name: 'bitnami/postgresql', current: '16', resolved: true }])
  })
})

# depwatch as an image, for the platforms on this list that run a container
# rather than a script — Northflank, Devtron, Tekton, Argo, and any Kubernetes
# runner you would rather not install Node into at run time.
#
#   docker build -t depwatch --build-arg DEPWATCH_REF=main examples/ci
#   docker run --rm -v "$PWD:/src" -w /src \
#     -e MAX_LIBYEARS=25 depwatch
#
# The build stage clones and compiles depwatch so the final image carries the
# bundle and no toolchain: esbuild produces a single file, so there is nothing
# else to copy.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
ARG DEPWATCH_REF=main
RUN apk add --no-cache git
WORKDIR /build
RUN git clone --depth 1 --branch "${DEPWATCH_REF}" \
      https://github.com/fabiocicerchia/depwatch.git . \
 && npm ci --ignore-scripts \
 && npm run build

FROM node:${NODE_VERSION}-alpine
# git, because the ratchet measures the base ref out of a worktree.
RUN apk add --no-cache git
COPY --from=build /build/dist/cli.js /opt/depwatch/dist/cli.js
COPY --from=build /build/examples/ci/depwatch-ci.sh /opt/depwatch/depwatch-ci.sh

# The script skips its own install step when the bundle is already there, which
# is the whole point of baking it in.
ENV DEPWATCH_HOME=/opt/depwatch

WORKDIR /src
ENTRYPOINT ["/opt/depwatch/depwatch-ci.sh"]

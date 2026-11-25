# Image used by the "docker" sandbox driver for every compile/run/debug step.
# Build: docker build -t cstudio-sandbox:latest backend/sandbox
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev clang clang-format gdb make \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work

# syntax = docker/dockerfile:1.2
FROM ubuntu:latest

RUN mkdir -p /data
VOLUME /data

RUN apt-get update && apt-get install --no-install-recommends --yes curl ca-certificates

WORKDIR /typesense
ADD https://dl.typesense.org/releases/0.20.0/typesense-server-0.20.0-linux-amd64.tar.gz /tmp/typesense.tar.gz
RUN tar xf /tmp/typesense.tar.gz

ENTRYPOINT /typesense/typesense-server --api-port=80 --data-dir=/data --api-key=${ADMIN_API_KEY}

EXPOSE 80
EXPOSE 8107

HEALTHCHECK --interval=30s --timeout=5s --retries=2 \
    CMD curl -sf http://localhost/health | grep -q "\"ok\":true"

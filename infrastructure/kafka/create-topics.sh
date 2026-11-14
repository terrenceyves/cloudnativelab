#!/bin/sh
set -eu
/opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists \
  --topic orders.created --partitions 1 --replication-factor 1 \
  --config retention.ms=604800000 --config retention.bytes=104857600 --config segment.bytes=10485760

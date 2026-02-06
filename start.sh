#!/bin/sh
set -a
if [ -f ./.env ]; then
  . ./.env
fi
set +a

if [ -n "$NODE_EXTRA_CA_CERTS" ]; then
  export NODE_EXTRA_CA_CERTS
fi

exec node server.js

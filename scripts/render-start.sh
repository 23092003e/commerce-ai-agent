#!/bin/sh
set -e

node packages/db/dist/migrate-cli.js
exec node apps/api/dist/main.js

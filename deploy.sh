#!/bin/bash
# Deploy Ginza Agents to VPS
# Usage: bash deploy.sh user@your-vps

set -e

TARGET="${1:?Usage: bash deploy.sh user@your-vps}"

rsync -av \
  --exclude='Docs' \
  --exclude='Assets' \
  --exclude='Skills' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='db/ginza.db' \
  --exclude='db/ginza.db-wal' \
  --exclude='db/ginza.db-shm' \
  --exclude='.git' \
  --exclude='Credentials' \
  "/Users/tayborpepper/Desktop/Master Ginza Project/" \
  "$TARGET:/home/ginza-agents/"

echo "Deploy complete."

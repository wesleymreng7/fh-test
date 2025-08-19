#!/usr/bin/env bash
set -euo pipefail

# Colors for logs
GREEN="\033[0;32m"
NC="\033[0m"

echo -e "${GREEN}🚀 Starting logistics app...${NC}"

# 1. Install dependencies
if [ ! -d "node_modules" ]; then
  echo -e "${GREEN}📦 Installing dependencies...${NC}"
  npm install
fi

# 2. Build TypeScript
if [ -f "tsconfig.json" ]; then
  echo -e "${GREEN}🔨 Building TypeScript project...${NC}"
  npm run build
fi

# 3. Start LocalStack (background)
if command -v localstack >/dev/null 2>&1; then
  echo -e "${GREEN}🛠️  Starting LocalStack in background...${NC}"
  localstack start -d
  echo -e "${GREEN}⏳ Waiting for LocalStack...${NC}"
  sleep 5
fi

# 4. Deploy Serverless services
if [ -f "serverless.yml" ]; then
  echo -e "${GREEN}📡 Deploying Serverless stack...${NC}"
  npm run deploy:local
fi

echo -e "${GREEN}✅ App is up and running!${NC}"

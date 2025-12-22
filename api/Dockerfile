FROM node:18-alpine

WORKDIR /app

# Needed for docker-compose healthcheck (curl -f http://localhost:3000/health)
RUN apk add --no-cache curl

# Copy package manifests (shared and api)
COPY shared/package*.json /shared/
COPY api/package*.json ./

# Copy source code (api and shared)
COPY api/ /app
COPY shared/ /shared

# Install and build shared (requires source now copied)
RUN cd /shared \
  && npm install \
  && npm run build

# Force local shared dependency to be used, install api deps, build, prune dev deps
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.dependencies=p.dependencies||{};p.dependencies['@shieldeye/shared']='file:/shared';fs.writeFileSync('package.json', JSON.stringify(p,null,2));" \
  && npm install \
  && npm run build \
  && npm prune --omit=dev

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S shieldeye -u 1001

# Change ownership
RUN chown -R shieldeye:nodejs /app
USER shieldeye

EXPOSE 3000

CMD ["npm", "run", "start"]

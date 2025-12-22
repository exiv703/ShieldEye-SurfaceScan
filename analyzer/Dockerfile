FROM node:18-alpine

WORKDIR /app

# Copy package manifests
COPY shared/package*.json /shared/
COPY analyzer/package*.json ./

# Copy source code
COPY analyzer/ /app
COPY shared/ /shared

# Build shared now that source is present
RUN cd /shared \
  && npm install \
  && npm run build

# Use local shared and install analyzer deps, then build and prune dev deps
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

CMD ["npm", "start"]

FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copy package manifests
COPY shared/package*.json /shared/
COPY renderer/package*.json ./

# Copy source code
COPY renderer/ /app
COPY shared/ /shared

# Build shared now that source is present
RUN cd /shared \
  && npm install \
  && npm run build

# Use local shared and install renderer deps, then build and prune dev deps
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.dependencies=p.dependencies||{};p.dependencies['@shieldeye/shared']='file:/shared';fs.writeFileSync('package.json', JSON.stringify(p,null,2));" \
  && npm install \
  && npm run build \
  && npm prune --omit=dev

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup --gid 1001 --system nodejs
RUN adduser --system --uid 1001 shieldeye

# Change ownership
RUN chown -R shieldeye:nodejs /app
USER shieldeye

CMD ["npm", "start"]

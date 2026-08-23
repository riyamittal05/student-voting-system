# Small, production-friendly Node image
FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached unless package*.json changes
COPY package*.json ./
RUN npm ci --omit=dev

# Now bring in the rest of the source
COPY . .

# Non-root user (the node image ships one out of the box) - don't run as root
USER node

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "app.js"]

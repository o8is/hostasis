FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source files
COPY src/ ./src/

# Create a non-root user to run the app
RUN addgroup -g 1001 -S keeper && \
    adduser -S keeper -u 1001 && \
    chown -R keeper:keeper /app

# Switch to non-root user
USER keeper

# Start the keeper bot
CMD ["node", "src/cli.js", "start"]

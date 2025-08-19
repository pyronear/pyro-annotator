# Multi-stage Dockerfile for PyroAnnotator Frontend

# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --only=production --silent

# Copy source code
COPY . .

# Build for production
RUN npm run build

# Production stage
FROM nginx:alpine as production

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Add labels for metadata
LABEL maintainer="Pyronear <contact@pyronear.org>"
LABEL description="PyroAnnotator Frontend - React application for wildfire detection annotation"
LABEL version="0.1.0"

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
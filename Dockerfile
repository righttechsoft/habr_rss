# Use official Deno runtime as the base image (using latest for node:sqlite support)
FROM denoland/deno:latest

# Set working directory
WORKDIR /app

# Install cron and other utilities
USER root
RUN apt-get update && apt-get install -y \
    cron \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

# Ensure proper permissions for database directory
RUN mkdir -p /app/db && chmod 755 /app/db

# Change ownership back to deno user
RUN chown -R deno:deno /app

# Make scripts executable
RUN chmod +x /app/hourly_tasks.sh /app/start.sh

# Copy supervisor configuration
RUN cp /app/habr_rss.conf /etc/supervisor/conf.d/habr_rss.conf

COPY crontab /etc/cron.d/cron
RUN chmod 0644 /etc/cron.d/cron && \
    crontab /etc/cron.d/cron

# Change ownership back to deno user
RUN chown -R deno:deno /app

# Cache dependencies by running a quick check
RUN deno check viewer.ts fetch_articles.ts ai_summary.ts

# Expose port
EXPOSE 8000

# Set environment variables
ENV PORT=8000
ENV DENO_DIR=/app/.deno_cache

# Health check (commented out for debugging)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

# Start supervisor which manages both cron and the web app
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/habr_rss.conf"]
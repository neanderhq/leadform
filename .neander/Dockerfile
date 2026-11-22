FROM node:22.23.2-alpine3.24@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.js ./
COPY --chown=node:node db ./db
COPY --chown=node:node public ./public
COPY .neander/entrypoint.sh /usr/local/bin/neander-entrypoint
RUN npm run build && chmod 755 /usr/local/bin/neander-entrypoint
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/neander-entrypoint"]
CMD ["node", "server.js"]

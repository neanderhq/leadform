FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
COPY .neander/entrypoint.sh /usr/local/bin/neander-entrypoint
RUN npm run build && chmod 755 /usr/local/bin/neander-entrypoint
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/neander-entrypoint"]
CMD ["npm", "start"]

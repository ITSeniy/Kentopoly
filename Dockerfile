FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/saves && chown node:node /app/saves
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]

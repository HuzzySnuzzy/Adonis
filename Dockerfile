# Docker-image dat de app vanuit de broncode draait.
# (Alternatief: gebruik het losse bestand werkopdrachten-linux-x64 in een Debian/Ubuntu-image.)
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY views ./views
COPY public ./public
# config.properties en data/ komen in /data
ENV WERKOPDRACHTEN_HOME=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "src/main.js", "--open-browser", "false"]

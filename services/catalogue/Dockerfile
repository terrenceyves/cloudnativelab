FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node src ./src
COPY --chown=node:node test ./test
USER node
EXPOSE 3002
CMD ["npm", "start"]

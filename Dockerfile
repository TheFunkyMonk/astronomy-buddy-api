FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

USER node
EXPOSE 3000

CMD ["node", "astronomy-buddy-api.js"]

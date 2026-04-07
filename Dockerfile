FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY dist/ dist/
COPY config.yaml ./

CMD ["tail", "-f", "/dev/null"]

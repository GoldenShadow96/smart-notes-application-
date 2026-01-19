FROM node:20-alpine

WORKDIR /app

# zależności
COPY package*.json ./
RUN npm ci --omit=dev

# kod
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

# TODO: podmień jeśli masz inny start
CMD ["npm", "start"]

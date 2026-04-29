FROM node:18-alpine
WORKDIR /app
COPY services/ripristina/package*.json ./
RUN npm install
COPY services/ripristina/ .
# Durante la build copiamo gli asset correnti così da renderli il nostro master
COPY shared/assets ./backup_assets
EXPOSE 3000
CMD ["npm", "start"]

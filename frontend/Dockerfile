FROM node:20-slim

WORKDIR /app

COPY package.json ./
COPY package-lock.json* ./

COPY . .

# Delete host node_modules and package-lock to prevent architecture clashes
RUN rm -rf node_modules package-lock.json

# Perform a clean install inside the container environment
RUN npm install

RUN npm run build

EXPOSE 3030

CMD ["npm", "run", "start", "--", "-p", "3030"]

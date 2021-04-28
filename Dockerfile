# Check out https://hub.docker.com/_/node to select a new base image
FROM node:10-slim

# Bind to all network interfaces so that it can be mapped to the host OS
ENV NODE_ENV=development
ENV WATCH=true
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PATH="${PATH}:/usr/src/gateway/node_modules/.bin"

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y git

RUN mkdir -p /usr/src/gateway

WORKDIR /usr/src/gateway

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install

# Bundle app source code
COPY . .

# NPM build
RUN npm run build

EXPOSE ${PORT}

CMD [ "node", "." ]

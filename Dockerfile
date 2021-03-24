# Check out https://hub.docker.com/_/node to select a new base image
FROM node:10-slim

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

# Bind to all network interfaces so that it can be mapped to the host OS
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE ${PORT}

CMD [ "node", "." ]

# Check out https://hub.docker.com/_/node to select a new base image
FROM node:12-slim

# Bind to all network interfaces so that it can be mapped to the host OS
ENV WATCH=true
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PATH="${PATH}:/usr/src/gateway/node_modules/.bin"

# Increases the maximum amount of available threads for some I/O operations
ENV UV_THREADPOOL_SIZE=128

RUN apt-get update && \
  apt-get upgrade -y && \
  apt-get install -y git

RUN mkdir -p /usr/src/gateway

WORKDIR /usr/src/gateway

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

# Installs the project
# Ignores installation scripts as of right now they're only used for development
# and may trigger errors
RUN npm ci --ignore-scripts

# Bundle app source code
COPY . .

# NPM build
RUN npm run build

EXPOSE ${PORT}

CMD ["npm", "run", "start"]

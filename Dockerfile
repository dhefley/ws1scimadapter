FROM node:alpine

RUN mkdir -p /usr/src/scimadapter
RUN mkdir -p /var/log/ws1scim
WORKDIR /usr/src/scimadapter

COPY . .

RUN apk --no-cache --virtual build-dependencies add \
    python \
    make \
    g++ \
    && npm install \
    && apk del build-dependencies

EXPOSE 9000
CMD ["npm","start"]
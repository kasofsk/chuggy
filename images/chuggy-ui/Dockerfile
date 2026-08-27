FROM node:26.7.0-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY ui/chuggy-ui/package.json ui/chuggy-ui/package.json
RUN npm ci --ignore-scripts

COPY scripts/check-console-policy.ts scripts/check-console-policy.ts
COPY ui/chuggy-ui ui/chuggy-ui
RUN npm run build --workspace=chuggy-ui

FROM nginx:1.31.4-alpine3.24@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913

COPY images/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/ui/chuggy-ui/dist/ /usr/share/nginx/html/
RUN mkdir -p /etc/chuggy/web

USER 101:101
EXPOSE 8080
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]

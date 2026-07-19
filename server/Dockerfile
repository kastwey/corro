# syntax=docker/dockerfile:1
#
# Multi-stage build for the Corro server. It builds the vanilla-TypeScript frontend, publishes the
# .NET 10 backend with that frontend baked into wwwroot, and ships a small ASP.NET runtime image — so
# the `full` compose profile can run the WHOLE stack in Docker with no local .NET SDK or Node.
#
# Build context is the repo ROOT (see docker-compose.yml: build.context = .), so paths are frontend/… and server/….

# 1) Frontend (vanilla TS, no bundler): compile + copy assets into dist/.
FROM node:20-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) Backend: publish with the built frontend pre-placed in wwwroot. SkipFrontendBuild=true so the
#    csproj's own npm build target is skipped (it would need Node here) and our wwwroot is kept as-is.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY server/ ./server/
COPY --from=frontend /src/frontend/dist ./server/wwwroot
RUN dotnet publish server/CorroServer.csproj -c Release -o /app/publish \
    -p:SkipFrontendBuild=true --nologo

# 3) Runtime: just the ASP.NET runtime + the published app.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=backend /app/publish ./
ENV ASPNETCORE_URLS=http://+:5000
EXPOSE 5000
ENTRYPOINT ["dotnet", "CorroServer.dll"]

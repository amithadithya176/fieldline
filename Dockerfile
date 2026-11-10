FROM node:24-bookworm-slim AS frontend
WORKDIR /src/Client
COPY Client/package.json Client/package-lock.json ./
RUN npm install --global npm@11.6.2 --no-audit --no-fund \
    && npm ci --no-audit --no-fund
COPY Client/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src/Server
COPY Server/Fieldline.csproj ./
RUN dotnet restore
COPY Server/ ./
COPY --from=frontend /src/Server/wwwroot/ ./wwwroot/
RUN dotnet publish -c Release --no-restore -o /publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /publish/ ./
RUN mkdir /app/data && chown app:app /app/data
ENV ASPNETCORE_HTTP_PORTS=8080 \
    Fieldline__DataDirectory=/app/data
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Fieldline.dll"]

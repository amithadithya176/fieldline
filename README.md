# Fieldline Equipment Operations

Fieldline is an Angular 21 and C# ASP.NET Core 10 demo for agricultural vehicle
sales, parts distribution, and shipment tracking. It starts with sample
equipment and orders. Try tracking ID **FL-2084** for a sample shipment.

## Run from source

Install the .NET 10 SDK and a Node.js release supported by
[Angular 21](https://angular.dev/reference/versions). From the repository root:

```sh
cd Client
npm ci
npm run build
cd ..
dotnet run --project Server/Fieldline.csproj --urls http://127.0.0.1:5068
```

Open http://127.0.0.1:5068. The Angular build writes to `Server/wwwroot`, and
ASP.NET Core serves both the website and its API. The server saves data in
`Server/App_Data/workspace.json`.

## Main workflows

- Add vehicle models or parts, receive inventory, and review stock alerts.
- Record an order with a quantity, destination, and estimated delivery date.
  The API checks availability, reserves stock, and generates a tracking ID.
- Record dispatch and delivery, then look up the shipment by tracking or order ID.

This demo supports one SKU per order. Staff enter shipment updates manually,
and the app records sales without collecting payment.

## Deploy the full application

Use a Docker web service with the repository root as the build context and
`Dockerfile` as the Dockerfile path. The Angular build is bundled into the C#
application, which serves both the frontend and API on port 8080. The app
expects a single service instance and a writable data directory.

For a local container:

```sh
docker build -t fieldline .
docker run --rm -p 127.0.0.1:8080:8080 -v fieldline-data:/app/data fieldline
```

For a host such as [Render](https://render.com/docs/docker), select Docker as
the runtime. A sample-data demo can use ephemeral storage. To preserve records
across deployments, mount writable persistent storage at `/app/data` or set
`Fieldline__DataDirectory` to a writable mount path. The demo API is accessible
to anyone who can reach the site. Use host-level access controls before entering
real customer data.

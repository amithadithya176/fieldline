using System.Text.Json;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);
var dataDirectory = builder.Configuration["Fieldline:DataDirectory"]
    ?? Path.Combine(builder.Environment.ContentRootPath, "App_Data");
builder.Services.AddSingleton(new WorkspaceStore(dataDirectory));
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
var api = app.MapGroup("/api");
api.MapGet("/workspace", (WorkspaceStore store) => store.Read());
api.MapPost("/items", (ItemInput input, WorkspaceStore store) => Apply(() => store.AddItem(input)));
api.MapPost("/items/{id}/receipts", (string id, ReceiptInput input, WorkspaceStore store) =>
    Apply(() => store.Receive(id, input)));
api.MapPost("/orders", (OrderInput input, WorkspaceStore store) => Apply(() => store.CreateOrder(input)));
api.MapPost("/shipments/{id}/advance", (string id, AdvanceInput input, WorkspaceStore store) =>
    Apply(() => store.Advance(id, input)));
api.MapGet("/tracking/{id}", (string id, WorkspaceStore store) =>
{
    var order = store.FindOrder(id);
    return order is null ? Results.NotFound(new { message = "No shipment found. Check the ID and try again." }) : Results.Ok(order);
});
api.MapFallback(() => Results.NotFound(new { message = "API route not found." }));
app.MapFallbackToFile("index.html");
app.Run();

static IResult Apply<T>(Func<T> action)
{
    try { return Results.Ok(action()); }
    catch (WorkspaceException error) { return Results.Json(new { message = error.Message }, statusCode: error.Status); }
}

sealed record Item(string Id, string Name, string Category, decimal Price, int Stock, int Reorder, string Type);
sealed record ShipmentEvent(int Step, DateTimeOffset Date);
sealed record Order(string Id, string Tracking, string Customer, string Destination, string ItemId, int Quantity,
    int Status, DateOnly Eta, decimal Total, DateTimeOffset Created, ShipmentEvent[] Events);
sealed record Workspace(Item[] Items, Order[] Orders, int NextOrder, int NextTracking);
sealed record ItemInput(string? Id, string? Name, string? Category, decimal? Price, int? Stock, int? Reorder, string? Type);
sealed record ReceiptInput(int Quantity);
sealed record OrderInput(string? Customer, string? Destination, string? ItemId, int Quantity, DateOnly? Eta);
sealed record AdvanceInput(int? ExpectedStatus);
sealed class WorkspaceException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

sealed class WorkspaceStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly Regex Sku = new(@"^[A-Z0-9][A-Z0-9_-]{0,31}$", RegexOptions.CultureInvariant);
    private readonly object gate = new();
    private readonly string path;
    private Workspace workspace;

    public WorkspaceStore(string directory)
    {
        Directory.CreateDirectory(directory);
        path = Path.Combine(directory, "workspace.json");
        if (File.Exists(path))
        {
            workspace = JsonSerializer.Deserialize<Workspace>(File.ReadAllText(path), Json)
                ?? throw new InvalidDataException("The Fieldline workspace file is empty.");
        }
        else
        {
            workspace = Seed();
            Persist(workspace);
        }
    }

    public Workspace Read()
    {
        lock (gate) return workspace;
    }

    public Order? FindOrder(string id)
    {
        var key = id.Trim().ToUpperInvariant();
        return Read().Orders.FirstOrDefault(order => order.Id == key || order.Tracking == key);
    }

    public Item AddItem(ItemInput input)
    {
        var id = Required(input.Id, "SKU", 32).ToUpperInvariant();
        if (!Sku.IsMatch(id)) throw new WorkspaceException("Use letters, numbers, hyphens, or underscores for the SKU.");
        var name = Required(input.Name, "Name", 80);
        var category = Required(input.Category, "Category", 50);
        if (input.Type is not ("vehicle" or "part")) throw new WorkspaceException("Choose vehicle or part.");
        if (input.Price is not (>= 0 and <= 100_000_000) || decimal.Round(input.Price.Value, 2) != input.Price)
            throw new WorkspaceException("Enter a valid unit price with up to two decimal places.");
        if (input.Stock is not (>= 0 and <= 1_000_000) || input.Reorder is not (>= 0 and <= 1_000_000))
            throw new WorkspaceException("Starting stock and reorder point must be between 0 and 1,000,000.");
        var item = new Item(id, name, category, input.Price.Value, input.Stock.Value, input.Reorder.Value, input.Type);
        lock (gate)
        {
            if (workspace.Items.Any(entry => entry.Id == id)) throw new WorkspaceException("This SKU is already in use.", 409);
            Persist(workspace with { Items = [.. workspace.Items, item] });
        }
        return item;
    }

    public Item Receive(string id, ReceiptInput input)
    {
        if (input.Quantity is < 1 or > 1_000_000)
            throw new WorkspaceException("Enter a quantity from 1 to 1,000,000.");
        lock (gate)
        {
            var item = ItemById(id);
            if (item.Stock > int.MaxValue - input.Quantity) throw new WorkspaceException("Stock would exceed the supported limit.");
            var updated = item with { Stock = item.Stock + input.Quantity };
            Persist(workspace with { Items = ReplaceItem(updated) });
            return updated;
        }
    }

    public Order CreateOrder(OrderInput input)
    {
        var customer = Required(input.Customer, "Customer", 80);
        var destination = Required(input.Destination, "Destination", 100);
        var id = Required(input.ItemId, "Item", 32);
        var eta = input.Eta ?? throw new WorkspaceException("Enter an estimated delivery date.");
        if (input.Quantity < 1) throw new WorkspaceException("Quantity must be at least one.");
        lock (gate)
        {
            var item = ItemById(id);
            if (input.Quantity > item.Stock)
                throw new WorkspaceException("The requested quantity exceeds available stock.", 409);
            var now = DateTimeOffset.UtcNow;
            var order = new Order($"ORD-{workspace.NextOrder}", $"FL-{workspace.NextTracking}", customer, destination,
                item.Id, input.Quantity, 0, eta, item.Price * input.Quantity, now, [new(0, now)]);
            Persist(workspace with
            {
                Items = ReplaceItem(item with { Stock = item.Stock - input.Quantity }),
                Orders = [order, .. workspace.Orders],
                NextOrder = workspace.NextOrder + 1,
                NextTracking = workspace.NextTracking + 1
            });
            return order;
        }
    }

    public Order Advance(string id, AdvanceInput input)
    {
        lock (gate)
        {
            var order = FindOrder(id) ?? throw new WorkspaceException("Shipment was not found.", 404);
            if (input.ExpectedStatus != order.Status || order.Status >= 2)
                throw new WorkspaceException("Shipment status has changed. Refresh the shipment and try again.", 409);
            var step = order.Status + 1;
            var updated = order with { Status = step, Events = [.. order.Events, new(step, DateTimeOffset.UtcNow)] };
            Persist(workspace with
            {
                Orders = workspace.Orders.Select(entry => entry.Id == order.Id ? updated : entry).ToArray()
            });
            return updated;
        }
    }

    private Item ItemById(string id) =>
        workspace.Items.FirstOrDefault(item => item.Id.Equals(id, StringComparison.OrdinalIgnoreCase))
        ?? throw new WorkspaceException("Item was not found.", 404);

    private Item[] ReplaceItem(Item updated) =>
        workspace.Items.Select(item => item.Id == updated.Id ? updated : item).ToArray();

    private void Persist(Workspace next)
    {
        var pending = path + ".tmp";
        File.WriteAllText(pending, JsonSerializer.Serialize(next, Json));
        File.Move(pending, path, overwrite: true);
        workspace = next;
    }

    private static string Required(string? input, string field, int limit)
    {
        var value = input?.Trim();
        if (string.IsNullOrEmpty(value) || value.Length > limit)
            throw new WorkspaceException($"{field} must contain 1–{limit} characters.");
        return value;
    }

    private static Workspace Seed()
    {
        Item[] items =
        [
            new("VEH-615", "FieldPro 615", "Utility tractor", 86500, 8, 2, "vehicle"),
            new("VEH-840", "FieldPro 840", "Row crop tractor", 142000, 5, 2, "vehicle"),
            new("VEH-920", "HarvestMax 920", "Combine harvester", 218500, 2, 1, "vehicle"),
            new("VEH-350", "Terrain 350", "Compact tractor", 37900, 14, 3, "vehicle"),
            new("VEH-220", "Tillage 220", "Disc cultivator", 18200, 7, 2, "vehicle"),
            new("VEH-460", "SeedLine 460", "Precision planter", 57500, 12, 2, "vehicle"),
            new("PT-1042", "Hydraulic Filter", "Hydraulics", 48, 4, 8, "part"),
            new("PT-2078", "PTO Drive Shaft", "Drivetrain", 289, 2, 5, "part"),
            new("PT-3016", "Fuel Injector Kit", "Engine", 174.5m, 0, 6, "part"),
            new("PT-1127", "Air Filter Assembly", "Engine", 72, 34, 8, "part"),
            new("PT-4092", "Tillage Disc Blade", "Ground engagement", 65, 48, 12, "part"),
            new("PT-5104", "Wheel Bearing Kit", "Drivetrain", 118, 22, 6, "part")
        ];
        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(DateTime.Today);
        Order Sample(int index, string customer, string city, string sku, int quantity, int status, int eta)
        {
            var created = now.AddDays(-index - 2);
            var events = Enumerable.Range(0, status + 1).Select(step => new ShipmentEvent(step, created.AddDays(step))).ToArray();
            return new($"ORD-{1058 - index}", $"FL-{2084 - index}", customer, city, sku, quantity, status,
                today.AddDays(eta), items.First(item => item.Id == sku).Price * quantity, created, events);
        }
        return new(items,
        [
            Sample(0, "Green Valley Farms", "Des Moines, IA", "VEH-615", 1, 1, 2),
            Sample(1, "Miller Ag Supply", "Omaha, NE", "PT-1127", 10, 0, 4),
            Sample(2, "Oakridge Cooperative", "Wichita, KS", "VEH-350", 2, 2, -1),
            Sample(3, "Red Barn Equipment", "Ames, IA", "PT-4092", 12, 1, 1),
            Sample(4, "Rolling Prairie Farm", "Sioux Falls, SD", "VEH-220", 1, 2, -2)
        ], 1059, 2085);
    }
}

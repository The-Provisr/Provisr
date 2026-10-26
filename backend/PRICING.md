# Provider pricing service

`pricing-service` listens on port `8091` and exposes `POST /v1/pricing/lookup`.
The service normalizes provider responses to `provider`, `service`, `region`,
`tier`, `unit`, `price_per_unit`, `currency`, `effective_date`, and
`freshness_metadata`. Expired records remain in PostgreSQL so provider outages
can return the last known offer with `freshness_metadata.stale: true` and a
warning.
Supply `tier` or at least one provider-specific filter so a lookup identifies
an offer instead of selecting a price arbitrarily from a service catalog.

Example request:

```json
{
  "provider": "aws",
  "service": "AmazonEC2",
  "region": "us-east-1",
  "tier": "m7i.large",
  "unit": "Hrs",
  "currency": "USD",
  "mode": "on_demand",
  "filters": { "operatingSystem": "Linux", "tenancy": "Shared" }
}
```

Use `mode: "bulk"` to query regional AWS Price List files. AWS on-demand
lookups call `GetProducts` and require `pricing:GetProducts` credentials through
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; temporary credentials can also
use `AWS_SESSION_TOKEN`. Azure Retail Prices are public retail list prices and
do not include negotiated discounts. Google Cloud public catalog lookups use
the Cloud Billing Catalog API and need `GCP_PRICING_API_KEY` with the Cloud
Billing API enabled. Custom Google Cloud contract prices are not included by
the public catalog endpoint.

Cache TTL defaults are 24 hours for `bulk` requests and one hour for
`on_demand` requests. Configure them with `PRICING_BULK_CACHE_TTL` and
`PRICING_ON_DEMAND_CACHE_TTL` (Go duration values such as `24h` or `30m`).
Apply migration `000024_pricing_cache.up.sql` before starting the service.

Provider API references:

- [AWS Price List Query API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_pricing_GetProducts.html) and [Bulk API price list files](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api-fetching-price-list-files-manually.html)
- [Azure Retail Prices REST API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Google Cloud Billing Catalog API](https://cloud.google.com/billing/v1/how-tos/catalog-api)

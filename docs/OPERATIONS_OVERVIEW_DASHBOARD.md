# Operations Overview Dashboard

## Purpose

The Operations Overview is a management dashboard for throughput, quality, and blockers.

It answers:

- How much content was ingested?
- How many outputs were generated, reviewed, queued, and published?
- Which categories are performing or failing?
- Where is the funnel blocked?
- Are media jobs slow or failing?
- Are prompt runs failing?
- Which fallback providers are working?

## Endpoint

```text
GET /internal/admin/analytics/overview?rangeDays=30&category=all
```

## Main sections

- KPI cards
- publishing funnel
- queue health chart
- provider attempts chart
- media performance cards
- prompt performance cards
- category performance table
- provider health table
- top blockers/recent failures table

## KPI examples

- Ingested
- Generated outputs
- Reviews sent
- Queued
- Published
- Media failure rate
- Prompt failures
- Average media processing time

## Limitations

Older rows without provider/timing metadata will still be counted, but provider/timing charts may show partial data.

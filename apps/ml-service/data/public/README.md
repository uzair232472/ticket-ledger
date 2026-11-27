# PUBLIC datasets (development experiments only)

Data-source class **PUBLIC**. These are externally published datasets with verified licenses. They are kept
apart from TicketLedger data, never enter a database export, are refused by `ml.train` and are never presented
as TicketLedger customer data or as evidence of real-world performance.

```
python scripts/fetch_public_datasets.py --list      # catalogue: sources, licenses, citations, suitability, rejected datasets
python scripts/fetch_public_datasets.py             # download (raw files are git-ignored; manifest.json records SHA-256)
python -m ml.public_experiment                      # purchase-intent method on Online Shoppers -> reports/public/
```

| Dataset | Source | License (checked 2026-11-21) | Used for |
|---|---|---|---|
| Online Shoppers Purchasing Intention (12,330 sessions) | UCI, doi 10.24432/C5F88Q | CC BY 4.0 | A. purchase-intent method experiment (e-commerce, not ticketing) |
| Online Retail II (1,067,371 transactions) | UCI, doi 10.24432/C5CG6D | CC BY 4.0 | D. behaviour-report method experiments (not fetched by default) |

Not used: hotel booking demand (license page unreadable, not ticketing), Kaggle Event Recommendation Engine
Challenge (rules unreadable; competition data), credit-card fraud (unrelated to bots). No public gate-scan /
crowd-flow dataset was found. No public ticketing dataset suitable for training TicketLedger models was found.

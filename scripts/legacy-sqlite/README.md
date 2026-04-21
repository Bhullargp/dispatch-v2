# Legacy SQLite scripts

These scripts were written for the old SQLite-based Dispatch app.

The live app now uses PostgreSQL (`dispatch` schema in `masterdb`).
Do not use these scripts against production data unless they are explicitly migrated first.

They were moved here during the 26.4.19 PostgreSQL cleanup to keep active tooling clearly separated from dead SQLite maintenance helpers.

You are completing a migration from better-sqlite3 to PostgreSQL (pg) in this Next.js app.

## CONTEXT
- The app already has src/lib/db.ts with a PostgreSQL pool and db() helper
- 41 files still import better-sqlite3 directly - these need to be migrated
- PostgreSQL schema is already set up in the dispatch schema of masterdb
- PostgreSQL uses $1, $2, $3 parameter placeholders, NOT ?

## DB HELPER API (from src/lib/db.ts)
```
import { db } from "@/lib/db";
// Usage:
const rows = await db().query("SELECT * FROM table WHERE col = $1", [value]);  // returns rows[]
const row = await db().get("SELECT * FROM table WHERE col = $1", [value]);     // returns row | undefined
const result = await db().run("INSERT INTO table (col) VALUES ($1)", [value]);  // returns { changes: number }
```

## MIGRATION RULES
For EVERY file that imports better-sqlite3:

1. Replace import Database from "better-sqlite3" with import { db } from "@/lib/db"
2. Remove import path from "path" if only used for dbPath
3. Remove const dbPath = path.resolve(process.cwd(), "dispatch.db") lines
4. Remove const db = new Database(dbPath) and db.close() calls
5. Convert SQLite calls to PostgreSQL:
   - db.prepare(sql).get(param1, param2) becomes await db().get(sql, [param1, param2])
   - db.prepare(sql).all(param1, param2) becomes await db().query(sql, [param1, param2])
   - db.prepare(sql).run(param1, param2) becomes await db().run(sql, [param1, param2])
   - Replace ? with $1, $2, $3... in SQL strings
   - For inline spread params (like ...scope.params or ...(access.adminMode ? [] : [access.session.userId])), collect into arrays instead
6. Server components that use DB become async (they likely already are)
7. Remove db.close() calls (PG uses connection pool, no close needed)
8. For files that reference tables NOT in the PostgreSQL schema (like user_settings, system_defaults, custom_pay_rules, extra_pay_items, trip_rules, password_reset_requests), still convert the code to use pg syntax. These tables may not exist in PG yet - just convert the code faithfully and note any missing tables.

## SPECIAL PATTERNS

### Spread params pattern:
SQLite: .get(trip_number, ...(access.adminMode ? [] : [access.session.userId]))
PostgreSQL: This becomes dynamic SQL. Build the query conditionally:
```
const query = access.adminMode 
  ? "SELECT * FROM trips WHERE trip_number = $1"
  : "SELECT * FROM trips WHERE trip_number = $1 AND user_id = $2";
const params = access.adminMode ? [trip_number] : [trip_number, access.session.userId];
const trip = await db().get(query, params);
```

### userScopedWhere pattern:
Check what userScopedWhere returns (it gives {clause, params}). The params array should work directly with pg.

### json_group_array (SQLite):
PostgreSQL uses json_agg or jsonb_agg instead of json_group_array(json_object(...)).
Use COALESCE(json_agg(json_build_object(...))::text, '[]') instead.

### Multiple sequential queries:
Since each db() call creates a new helper instance, you can call db() multiple times or store it:
```
const d = db();
const rows = await d.query(...);
const row = await d.get(...);
```

## IMPORTANT
- Do NOT modify src/lib/db.ts
- Do NOT modify the PostgreSQL schema
- Do NOT delete dispatch.db
- Remove better-sqlite3 and @types/better-sqlite3 from package.json when done
- After all changes, run npm install and npm run build and fix any build errors
- Report which files you changed and any issues found

Start now. Migrate ALL 41 files systematically.

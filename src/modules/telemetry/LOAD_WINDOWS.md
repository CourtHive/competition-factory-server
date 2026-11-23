# Process measurement windows

The super-admin load-profile routes measure one CFS process. POST `/admin/load-profile/window` starts a fresh window. GET `/admin/load-profile/window/:id` reads it, POST `.../:id/reset` starts a new window with a new ID and POST `.../:id/stop` reads and closes it. Overlapping starts and stale IDs return 409. An abandoned window closes after one hour.

All three histograms return counts and p50/p99/max in milliseconds. Event-loop delay uses the Node histogram at 10 ms resolution (idle readings include that interval). Lock acquisition covers each tournament ID until acquisition settles. Core Postgres pool checkout includes connection establishment, queueing and event-loop scheduling until delivery. Neither wait includes time holding a lock or executing SQL. Samples spanning a boundary belong only to the window in which they began and completed. No sampler, timer, wrapper or per-request clock runs outside a window.

For sustained simulation load, set `SIMULATION_FACTORY_USER_ID` to the seeded user's database UUID and `SIMULATION_FACTORY_LIMIT_PER_MINUTE` to a finite integer above 300 and no more than 60000. The verified user context selects a separate quota on the two factory command and query routes. Other identities and routes use their usual limits. Omit the settings for the normal-limit comparison.

The `shardCache` field counts a cache-enabled read when its SELECT starts and its result passes validation in the same window on the same pool. A reset excludes reads still in flight from both windows.
`reused` counts bodies omitted by PostgreSQL and read from the worker cache. `transferred` counts
bodies returned by PostgreSQL. Each has separate shell, draw and participant counts. One action query
may read hundreds of participant parts. Zero reads can mean the feature was disabled or the requests
used other storage paths. These counters are independent of the optional locality collector.

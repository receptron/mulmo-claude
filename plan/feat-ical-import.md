# feat: Import events from iCal URL

## Goal

Allow users to subscribe to iCal URLs (Google Calendar, Outlook) and import events into the scheduler.

## Data model

### iCal sources config

`~/mulmoclaude/scheduler/ical-sources.json`:

```json
[
  { "id": "src_xxx", "name": "Work Calendar", "url": "https://calendar.google.com/calendar/ical/.../basic.ics" }
]
```

### Imported ScheduledItems

Imported items use existing `ScheduledItem` format with extra props:

- `source`: `"ical"` — marks as imported (not manually created)
- `sourceId`: references the iCal source id
- `uid`: iCal VEVENT UID — used to deduplicate on re-sync

## Server changes

### `server/routes/ical.ts` (new)

| Endpoint | Action |
|---|---|
| `POST /api/ical` `action: "list_sources"` | List configured iCal sources |
| `POST /api/ical` `action: "add_source"` | Add a new iCal URL (name + url) |
| `POST /api/ical` `action: "remove_source"` | Remove a source by id |
| `POST /api/ical` `action: "sync"` | Fetch all sources, parse VEVENTs, merge into scheduler items |

### Sync logic

1. Fetch each source URL with `node-ical`
2. Filter for `VEVENT` entries
3. Convert to `ScheduledItem` (summary → title, dtstart → date/time, location, description)
4. Remove existing items with matching `sourceId` from scheduler
5. Insert new items
6. Save to `items.json`

## Tool definition changes

### `src/plugins/scheduler/definition.ts`

Add actions to `manageScheduler`:
- `add_ical_source` (params: `name`, `icalUrl`)
- `remove_ical_source` (params: `sourceId`)
- `list_ical_sources`
- `sync_ical`

## Documentation

- `docs/ical-setup.md` — step-by-step guide for getting iCal URLs from Google Calendar and Outlook

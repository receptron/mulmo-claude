# iCal Calendar Import Setup

MulmoClaude can import events from external calendars via iCal URL subscription. This guide explains how to get your iCal URL and configure the import.

## Getting Your iCal URL

### Google Calendar

1. Open [Google Calendar](https://calendar.google.com/) in your browser
2. Click the **gear icon** (top right) → **Settings**
3. In the left sidebar, click the calendar you want to import under **"Settings for my calendars"**
4. Scroll down to **"Integrate calendar"**
5. Copy the **"Secret address in iCal format"** URL
   - It looks like: `https://calendar.google.com/calendar/ical/xxxx/basic.ics`

> **Important**: This URL contains a secret token. Anyone with this URL can read your calendar. Do not share it publicly.

### Outlook / Microsoft 365

1. Open [Outlook Calendar](https://outlook.live.com/calendar/) in your browser
2. Click the **gear icon** → **View all Outlook settings**
3. Go to **Calendar** → **Shared calendars**
4. Under **"Publish a calendar"**, select the calendar and permission level
5. Click **Publish** and copy the **ICS** link

### Other Calendar Services

Most calendar services support iCal export. Look for options like:
- "Subscribe to calendar"
- "iCal URL" or "ICS link"
- "Secret address in iCal format"
- "Publish calendar"

## Adding a Calendar Source in MulmoClaude

Once you have the iCal URL, tell the assistant:

```
Add my Google Calendar: https://calendar.google.com/calendar/ical/xxxx/basic.ics
```

Or be more specific:

```
Add an iCal source named "Work Calendar" with URL https://calendar.google.com/calendar/ical/xxxx/basic.ics
```

The assistant will register the source and offer to sync events.

## Syncing Events

To import events from all configured sources:

```
Sync my calendar
```

This fetches the latest events from all registered iCal URLs and merges them into your scheduler. Manually created events are preserved.

## Managing Sources

- **List sources**: "Show my iCal sources"
- **Remove a source**: "Remove the Work Calendar iCal source"
- **Re-sync**: "Sync my calendar" (can be run anytime to get the latest events)

## How It Works

- Imported events are marked with `source: "ical"` so they can be distinguished from manual entries
- Each sync replaces all previously imported events from the same source with fresh data
- Manual events (created directly in MulmoClaude) are never affected by sync
- Removing a source also removes all events imported from it

## Troubleshooting

| Problem | Solution |
|---|---|
| "No iCal sources configured" | Add a source first (see above) |
| Sync fails with timeout | Check that the URL is accessible. Some corporate firewalls block outbound requests |
| Events are missing | The iCal feed may only include future events. Check your calendar's export settings |
| Duplicate events | Events are deduplicated by UID. If you see duplicates, they likely have different UIDs in the source |

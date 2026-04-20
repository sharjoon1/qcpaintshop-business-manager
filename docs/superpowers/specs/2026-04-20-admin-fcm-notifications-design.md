# Admin FCM Notifications — Design Spec

## Goal

Allow admin to compose and send rich push notifications to painters with image support, a custom MP3 notification sound, and fine-grained audience filtering.

---

## Architecture

A new `admin_notifications` table stores every sent notification for auditability. A `routes/admin-notifications.js` handler validates, fans out FCM calls in batches of 500, and persists the result. `services/fcm-admin.js` is upgraded to support image URL and Android notification channel. The Android painter app gains a new `qc_admin_channel` notification channel backed by a custom MP3.

**Tech Stack:** Express.js, MariaDB, FCM Admin SDK, Sharp (image resize), Jetpack Compose / `QCFirebaseMessagingService.kt`

---

## Data Layer

### Table: `admin_notifications`

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK AUTO_INCREMENT | |
| `title` | VARCHAR(200) NOT NULL | |
| `body` | TEXT NOT NULL | |
| `image_url` | VARCHAR(500) | Nullable; path relative to server root |
| `type` | ENUM('info','offer') NOT NULL | |
| `offer_url` | VARCHAR(500) | Nullable; required when type=offer |
| `audience_type` | ENUM('all','branch','level','city','specific') NOT NULL | |
| `audience_value` | JSON | NULL when all; array of IDs/strings otherwise |
| `reach_count` | INT DEFAULT 0 | Count of FCM tokens targeted |
| `sent_at` | DATETIME NOT NULL | Server time at send |
| `created_by` | INT NOT NULL | Admin user ID (FK users.id) |

### Image Storage

- Upload path: `/public/uploads/admin-notif-images/`
- Max upload size: 2MB
- Accepted types: JPEG, PNG
- Sharp resizes to max 1024px wide before saving, preserving aspect ratio
- Filename: `notif_<timestamp>_<random>.jpg`

### Migration file

`migrations/migrate-admin-notifications.js` — creates table + ensures upload directory exists.

---

## API Routes

Mount point: `/api/admin-notifications`  
Permission: `painters.manage`

### `POST /upload-image`
- Multer single-file upload (field: `image`)
- Sharp resize → save to upload dir
- Returns `{ imageUrl: '/uploads/admin-notif-images/<filename>' }`

### `POST /`
Request body:
```json
{
  "title": "string (required)",
  "body": "string (required)",
  "imageUrl": "string (optional)",
  "type": "info | offer",
  "offerUrl": "string (required when type=offer)",
  "audienceType": "all | branch | level | city | specific",
  "audienceValue": ["array of IDs or strings, null when all"]
}
```
- Validate: title+body required; offerUrl required when type=offer
- Query `painter_fcm_tokens JOIN painters` filtered by audience (see Fan-out Logic)
- Batch FCM sends in groups of 500
- Insert `admin_notifications` row with `reach_count = total tokens targeted`
- Returns `{ success: true, reach: N }`

### `GET /`
- Query params: `page` (default 1), `limit` (default 20)
- Returns paginated list ordered by `sent_at DESC`
- Fields: `id, title, type, audience_type, reach_count, sent_at`

### `GET /audience-count`
- Query params: `audienceType`, `audienceValue` (JSON-encoded array or omitted for 'all')
- Returns `{ count: N }` — number of active painters with FCM tokens matching the audience
- Used by the Compose UI to show "~N painters" in the confirmation dialog before sending

### `GET /:id`
- Returns full notification detail including `body`, `image_url`, `offer_url`, `audience_value`

---

## Fan-out Logic

### Audience filtering

| `audienceType` | Filter on `painters` table |
|---|---|
| `all` | No filter — all tokens |
| `branch` | `painters.branch_id IN (audienceValue)` |
| `level` | `painters.level IN (audienceValue)` |
| `city` | `painters.city IN (audienceValue)` |
| `specific` | `painters.id IN (audienceValue)` |

Only painters with `status = 'active'` and a non-null FCM token are targeted.

### FCM payload

```js
{
  notification: {
    title,
    body,
    image: imageUrl ?? undefined,   // FCM big-picture style
  },
  android: {
    notification: {
      channelId: 'qc_admin_channel',
      sound: 'app_notification',
    },
  },
  data: {
    type,                         // 'info' or 'offer'
    offerUrl: offerUrl ?? '',
    notificationId: String(id),
  },
}
```

### FCM service upgrade (`services/fcm-admin.js`)

Add `imageUrl` and `channelId` params to `sendToDevice()` and a new `sendToDevices(tokens[], payload)` batch method using FCM `sendEachForMulticast`.

---

## Android Changes (Painter Flavor)

### 1. Custom sound asset

Add file: `app/src/painter/res/raw/app_notification.mp3`  
Source: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\app_notification.mp3`

### 2. New notification channel

In `QCFirebaseMessagingService.kt` `createNotificationChannels()`, add channel:

```kotlin
val adminChannel = NotificationChannel(
    "qc_admin_channel",
    "QC Updates",
    NotificationManager.IMPORTANCE_HIGH
).apply {
    val soundUri = Uri.parse(
        ContentResolver.SCHEME_ANDROID_RESOURCE + "://" +
        context.packageName + "/" + R.raw.app_notification
    )
    setSound(soundUri, AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .build())
}
notificationManager.createNotificationChannel(adminChannel)
```

### 3. Tap behaviour

In `QCFirebaseMessagingService.onMessageReceived()`:
- If `data["type"] == "offer"` and `data["offerUrl"]` is non-empty → intent opens WebView at that URL
- Otherwise → intent opens painter dashboard home

Existing `qc_notifications` and `qc_geofence_alerts` channels are unchanged.

---

## Admin UI

Location: new **"Notifications"** tab in `admin-painters.html`

### Sub-view A: Compose

Form fields:
1. **Title** — text input (required)
2. **Body** — textarea (required)
3. **Type** — toggle button: `Info` / `Offer`. Selecting Offer reveals a URL field (required).
4. **Image** — optional file picker (JPEG/PNG, max 2MB). Shows thumbnail preview after upload.
5. **Audience** — dropdown:
   - All Painters
   - By Branch → multi-select branch chips
   - By Level → multi-select level chips (Bronze/Silver/Gold/Platinum)
   - By City → text tags input
   - Specific Painters → search-as-you-type painter picker (name/phone)
6. **Send** button → calls `GET /audience-count` with current audience selection → confirmation dialog: "Send to ~N painters?" → Confirm → POST → success toast with reach count

### Sub-view B: History

Table columns: Date/Time | Title | Type | Audience | Reach | Actions  
Actions: eye icon → modal showing full notification detail (body, image, offer URL, audience breakdown).

Pagination: 20 per page.

---

## Permissions

Reuses existing `painters.manage` permission — no new permission needed.

---

## Testing

- Upload image → verify Sharp resize + correct path returned
- Send to `all` → verify reach_count matches active painter token count
- Send to specific painters → verify only those tokens receive FCM call
- Offer notification → verify `offerUrl` saved + returned in GET /:id
- Info notification → verify `offerUrl` is null/empty
- History endpoint → verify pagination and ordering
- Android: install APK, receive admin notification → custom MP3 plays, tap opens correct screen

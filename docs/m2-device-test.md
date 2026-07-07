# M2 device test — airplane-mode canvass

The automated exit test (`npm run test:m2`) proves the sync engine against
the live backend. This checklist is the on-phone version of the same loop,
using Expo Go — run it once per release until we have store builds.

## Setup (once)

1. Install **Expo Go** from the App Store / Play Store.
2. On the PC: `npm run dev:field` (repo root). A QR code appears.
3. Scan the QR with the phone (Camera app on iOS, Expo Go on Android).
   Phone and PC must be on the same Wi-Fi.
4. Sign in as the test canvasser:
   - email: `m1-canvasser-a@canvara-test.dev`
   - password: `m1-test-canvasser-8k4p`

## The test

1. **Sync down**: pull to refresh on the home screen. Expect
   "M1 Test Walk List" and "M2 Test Walk List" to appear.
2. **Start shift** (still online). Expect "On shift".
3. **Airplane mode ON.**
4. Open the M2 walk list → canvass 5 doors:
   - Doors 1–4: tap the door → *Disclosed — start conversation* → speak a
     few seconds → *End conversation* → pick a contact result.
   - Door 5: *Not home*.
   - Expect each door to return to the list with its status updated,
     entirely offline.
5. Home screen should show **"5 captures waiting to sync"**.
6. **Airplane mode OFF.** Within a few seconds expect the
   "Synced 5 pending captures" notice and the badge to clear.
7. Verify in the console (or Supabase dashboard): 4 new rows in
   `conversations` with `status = uploaded`, `consent_disclosed_at` set,
   audio files under `conversations/{campaign_id}/` in Storage, and the
   walk-list stops showing visited / not home.

## Known M2 limits

- Shift start/end needs connectivity (captures attach to the last-started
  shift while offline).
- The map shows pins only for voters with coordinates (the M2 test list
  has them; the M1 import has none — geocoding lands with GPS correlation
  work in M3+).
- Sync triggers on app-foreground/reconnect, not OS background tasks yet.

# YouTube Hider Feature Parity Plan

Source reviewed: `MatteoLucerni/youtube-hider-extension` (develop branch).

## Features from MatteoLucerni repo

- Hide watched videos with a percentage threshold
- Minimum views filter
- Upload date filter (hide newer-than / older-than)
- Hide Shorts
- Hide Mixes
- Hide Playlists
- Hide Lives
- Easy mode / advanced mode popup UX
- Filter mode: hide vs dim
- Floating quick-settings button + onboarding tutorial
- Extension badge OFF state

## What is now implemented in this branch

- Hide watched videos (existing, now uses a safer page parser)
- Hide Mixes (new)
- Hide Playlists (new)
- Hide Lives (new)
- Minimum views filter (new)
- Upload date filter with newer/older thresholds (new)

## Already existing in TizenTube before this change

- Hide Shorts (existing `enableShorts` toggle)

## Not implemented yet (would require larger UI/runtime work)

- Filter mode with dim overlays instead of full hide
- Floating quick-settings button and guided tutorial
- Easy/Advanced mode UX split
- Badge OFF state semantics from the Chrome extension


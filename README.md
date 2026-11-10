# Herdify

A Spotify player you can dock or float in the [Herdr](https://herdr.dev) desktop app: album cover, title and artist, shuffle, previous, play/pause, next and repeat, a seek bar and a volume bar, docked at the foot of the window.

![Herdify](herdify/preview.png)

macOS only. It controls the Spotify desktop app through AppleScript (`osascript`) and downloads cover art with `curl`. macOS may ask once whether Herdr may control Spotify.

## Install

Tell your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/a88as/herdify
```

Or by hand:

```sh
cp -R herdify/mods/herdify ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/herdify
```

**Moving it:** the move button (four arrows, after repeat) offers the sidebar, the top of the work area, above the status bar, or floating. It edits your layout for you; it works in personal layouts only.

It can also be a floating player that you drag to any edge (a card on the sides, a bar on the top and bottom). Add this to the root of a personal layout (`layouts/<yours>.json`; Herdr's shipped layouts are read-only, so clone one first with `layout.clone`):

```json
"floating": [ { "id": "herdify", "content": { "mod": "herdify" }, "edge": "right", "align": "end" } ]
```

| Side edges | Top and bottom edges |
| --- | --- |
| ![](herdify/floating-card.png) | ![](herdify/floating-bar.png) |

It hides itself while Spotify is closed.

### Docked

It never docks by itself. Add the block below to a personal layout, then use its move button to change spots. To place it yourself, add this block to a layout of your own (Herdr's shipped layouts take no new blocks; clone one first with `layout.clone`):

```json
{ "id": "herdify", "type": "block", "size": { "px": 72 }, "content": { "mod": "herdify" } }
```

It also fits the left sidebar. Below 480 px wide it becomes a stacked card, and in a folded sidebar it is a single play/pause button. Put it in the `sidebar` column above `sidebar-footer`, and pass its own id as `block` so it sizes itself:

```json
{ "id": "herdify", "type": "block", "size": { "px": 124 }, "content": { "mod": "herdify", "props": { "block": "herdify" } } }
```

![Herdify in the sidebar](herdify/sidebar.png)

## Keys

The buttons are also commands: `herdify.toggle`, `herdify.next`, `herdify.previous`, `herdify.shuffle`, `herdify.repeat`, `herdify.mute` (click the speaker icon to mute; click again to restore the volume). For example in `keys.json`:

```json
{ "global": { "ctrl-alt-space": "herdify.toggle", "ctrl-alt-right": "herdify.next", "ctrl-alt-left": "herdify.previous" } }
```

## Build it yourself

[`herdify/RECIPE.md`](herdify/RECIPE.md) is the brief an agent can build it from in an empty folder.

Icons are from [Lucide](https://lucide.dev) (ISC). Not affiliated with Spotify.

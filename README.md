# Herdrify

A Spotify now-playing bar for the [Herdr](https://herdr.dev) desktop app: album cover, title and artist, shuffle, previous, play/pause, next and repeat, a seek bar and a volume bar, docked at the foot of the window.

![Herdrify](herdrify/preview.png)

macOS only. It controls the Spotify desktop app through AppleScript (`osascript`) and downloads cover art with `curl`. macOS may ask once whether Herdr may control Spotify.

## Install

Tell your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/a88as/herdrify
```

Or by hand:

```sh
cp -R herdrify/mods/herdrify ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/herdrify
```

It docks at the bottom of a personal layout by itself. To place it yourself, add this block to a layout of your own (Herdr's shipped layouts take no new blocks; clone one first with `layout.clone`):

```json
{ "id": "herdrify", "type": "block", "size": { "px": 72 }, "content": { "mod": "herdrify" } }
```

## Keys

The buttons are also commands: `herdrify.toggle`, `herdrify.next`, `herdrify.previous`, `herdrify.shuffle`, `herdrify.repeat`. For example in `keys.json`:

```json
{ "global": { "ctrl-alt-space": "herdrify.toggle", "ctrl-alt-right": "herdrify.next", "ctrl-alt-left": "herdrify.previous" } }
```

## Build it yourself

[`herdrify/RECIPE.md`](herdrify/RECIPE.md) is the brief an agent can build it from in an empty folder.

Icons are from [Lucide](https://lucide.dev) (ISC). Not affiliated with Spotify.

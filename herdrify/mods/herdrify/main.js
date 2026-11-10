// herdrify: a Spotify now-playing bar for the foot of the window. Album art, the track
// and artist, shuffle, previous, play/pause, next, repeat, a seek bar and a volume bar.
//
// It talks to the Spotify desktop app on macOS through AppleScript (`osascript`): one
// read every 2 s while a track plays (5 s otherwise), and one command per press. Between
// reads the clock moves on its own. It never launches Spotify by itself: the read asks
// `application "Spotify" is running` first. macOS asks once to let Herdr control Spotify.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Slider, SliderTrack, SliderIndicator, SliderThumb, SliderState } from "gpui-base";
import * as fs from "fs/promises";
import { exec, appHome, theme, nextCommand, props, layout, run, placement } from "herdr";

const NAME = "herdrify";
const ICON = (name) => `mods/${NAME}/${name}.svg`;
const GREEN = "#1ed760";
const ART_DIR = "data/herdrify/art"; // under appHome(): image() paths are relative to it
const SEP = "\u001f";
// Widths below these switch the look: a stacked card for a side panel, one button for a folded rail.
const COMPACT_BELOW = 480;
const RAIL_BELOW = 160;
// Block heights per look, used when props.block names the block to fit.
const HEIGHT = { bar: 72, compact: 124, compactIdle: 44, rail: 52 };
const AUTOMATION = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

const READ = `if application "Spotify" is running then
  tell application "Spotify"
    set sep to character id 31
    set playerNow to player state as text
    if playerNow is "stopped" then return "stopped"
    set tr to current track
    return playerNow & sep & (name of tr) & sep & (artist of tr) & sep & (album of tr) & sep & ((duration of tr) as text) & sep & ((player position) as text) & sep & (artwork url of tr) & sep & (id of tr) & sep & (shuffling as text) & sep & (repeating as text) & sep & ((sound volume) as text)
  end tell
else
  return "off"
end if`;

const ACTIONS = {
  toggle: () => "playpause",
  next: () => "next track",
  previous: () => "previous track",
  shuffle: () => "set shuffling to not shuffling",
  repeat: () => "set repeating to not repeating",
  seek: (n) => `set player position to ${Math.max(0, Math.round(n))}`,
  volume: (n) => `set sound volume to ${Math.max(0, Math.min(100, Math.round(n)))}`,
};

// AppleScript prints numbers with the locale's decimal mark ("12,5" in many places).
const num = (s) => parseFloat(String(s ?? "").replace(",", ".")) || 0;
const clock = (s) => {
  const whole = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

function parse(r) {
  if (r.code !== 0) {
    if (/-1743|Not authori[sz]ed/i.test(r.stderr)) return { denied: true };
    return { off: true };
  }
  const out = r.stdout.replace(/\n$/, "");
  if (out === "off") return { off: true };
  if (out === "stopped") return { stopped: true };
  const f = out.split(SEP);
  if (f.length < 11) return { off: true };
  const [state, title, artist, album, duration, position, art, id, shuffle, repeat, volume] = f;
  return {
    track: true,
    playing: state === "playing",
    title, artist, album,
    duration: num(duration) / 1000, // ms in Spotify
    position: num(position),
    art: art && art !== "missing value" ? art : null,
    id,
    shuffle: shuffle === "true",
    repeat: repeat === "true",
    volume: num(volume),
    at: Date.now(),
  };
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

export default class Herdrify extends View {
  init(_props, cx) {
    this.state = null;
    this.width = 900;
    this.ticks = 0;
    this.seekDrag = false;
    this.volDrag = false;
    this.seek = SliderState.new({ min: 0, max: 1000, step: 1, value: 0 });
    this.vol = SliderState.new({ min: 0, max: 100, step: 1, value: 50 });
    this.seek.on("change", (_v, cx) => { this.seekDrag = true; cx.notify(); });
    this.seek.on("release", (v, cx) => {
      this.seekDrag = false;
      const s = this.state;
      if (!s?.track || !s.duration) return;
      const pos = (v / 1000) * s.duration;
      s.position = pos; s.at = Date.now();
      this.act("seek", cx, pos);
    });
    this.vol.on("change", (_v, cx) => { this.volDrag = true; cx.notify(); });
    this.vol.on("release", (v, cx) => {
      this.volDrag = false;
      if (this.state?.track) this.state.volume = v;
      this.act("volume", cx, v);
    });
    cx.timer.every(1000, (cx) => {
      const s = this.state;
      this.ticks++;
      if (s?.track && s.playing) { this.syncSliders(); cx.notify(); }
      if (this.ticks % (s?.playing ? 2 : 5) === 0) cx.spawn((cx) => this.poll(cx));
    });
    cx.spawn(async (cx) => {
      await fs.mkdir(`${appHome()}/${ART_DIR}`, { recursive: true }).catch(() => {});
      await this.poll(cx);
    });
    // herdrify.toggle / .next / .previous / .shuffle / .repeat from keys.json or `herdr-app do`.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand());
        if (c in ACTIONS && c !== "seek" && c !== "volume") this.act(c, cx);
      }
    });
  }

  position() {
    const s = this.state;
    if (!s?.track) return 0;
    const p = s.playing ? s.position + (Date.now() - s.at) / 1000 : s.position;
    return s.duration ? Math.min(s.duration, p) : p;
  }

  syncSliders() {
    const s = this.state;
    if (!s?.track) return;
    if (!this.seekDrag) this.seek.set_value(s.duration ? Math.round((this.position() / s.duration) * 1000) : 0);
    if (!this.volDrag) this.vol.set_value(Math.round(s.volume));
  }

  async poll(cx) {
    if (this.busy) return;
    this.busy = true;
    try {
      let r;
      try { r = await exec("osascript", ["-e", READ], { timeout: 4000 }); }
      catch (_) { r = { code: 1, stdout: "", stderr: "" }; }
      const next = parse(r);
      if (next.track && next.art) await this.fetchArt(next).catch(() => { next.artFile = null; });
      else if (next.track) next.artFile = null;
      this.state = next;
      this.syncSliders();
      cx.notify();
    } finally { this.busy = false; }
  }

  // Covers are saved once per track under data/herdrify/art and the older ones removed.
  async fetchArt(s) {
    const key = (s.id.split(":").pop() || "x").replace(/[^A-Za-z0-9_-]/g, "");
    const rel = `${ART_DIR}/${key}.jpg`;
    if (this.state?.artFile === rel) { s.artFile = rel; return; }
    const abs = `${appHome()}/${rel}`;
    const have = await fs.exists(abs).catch(() => false);
    if (!have) {
      const r = await exec("curl", ["-sfL", "--max-time", "8", "-o", abs, s.art]).catch(() => null);
      if (!r || r.code !== 0) { s.artFile = null; return; }
      const names = await fs.readdir(`${appHome()}/${ART_DIR}`).catch(() => []);
      for (const n of names) if (n !== `${key}.jpg`) await fs.unlink(`${appHome()}/${ART_DIR}/${n}`).catch(() => {});
    }
    s.artFile = rel;
  }

  act(action, cx, value) {
    const s = this.state;
    // Shown at once; the next read sets it right.
    if (s?.track) {
      if (action === "toggle") { s.position = this.position(); s.at = Date.now(); s.playing = !s.playing; }
      if (action === "shuffle") s.shuffle = !s.shuffle;
      if (action === "repeat") s.repeat = !s.repeat;
    }
    cx.notify();
    const script = `if application "Spotify" is running then tell application "Spotify" to ${ACTIONS[action](value)}`;
    cx.spawn(async (cx) => {
      await exec("osascript", ["-e", script], { timeout: 4000 }).catch(() => {});
      if (action === "next" || action === "previous") await new Promise((res) => cx.timer.after(300, () => res()));
      await this.poll(cx);
    });
  }

  openSpotify(cx) {
    cx.spawn(async (cx) => {
      await exec("open", ["-a", "Spotify"]).catch(() => {});
      await this.poll(cx);
    });
  }

  mode() {
    return this.width < RAIL_BELOW ? "rail" : this.width < COMPACT_BELOW ? "compact" : "bar";
  }

  // With props.block, the block takes the height its look needs (a stacked card is taller
  // than the bar, idle is shorter). Without it, the layout's size stands.
  fit() {
    const id = props()?.block;
    if (!id) return;
    const m = this.mode(), track = !!this.state?.track;
    const px = m === "bar" ? HEIGHT.bar : m === "rail" ? HEIGHT.rail : track ? HEIGHT.compact : HEIGHT.compactIdle;
    if (px === this.fitted) return;
    const node = find(layout(), id);
    if (!node) return;
    this.fitted = px;
    if (node.size?.px !== px) run("layout.resize", { id, px });
  }

  render() {
    const t = theme(), s = this.state;
    // Floating (a layout's "floating" list): Herdr draws the frame and people drag it to any
    // edge. A card on the left and right edges, a bar on the top and bottom.
    const pl = placement();
    const mode = pl ? (pl.vertical ? "compact" : "bar") : this.mode();
    if (!pl) this.fit();
    const measure = (el) => el.on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 2) { this.width = size.width; cx.notify(); } });

    const pill = (id, label, onClick) => div().id(id).px(10).py(4).rounded(12).flex_none().cursor_pointer()
      .bg(t.raised).text_color(t.foreground).text_size(11.5).hover((el) => el.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx)).child(label);
    const btn = (id, icon, tip, on = false) => div().id(`hfy-${id}`).size(28).flex_none().flex().items_center().justify_center()
      .rounded(6).cursor_pointer().text_color(on ? GREEN : t.muted)
      .hover((el) => el.bg(t.hover).text_color(on ? GREEN : t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.act(id, cx))
      .child(svg(ICON(icon)).size(14));
    const playBtn = () => div().id("hfy-toggle").size(32).flex_none().flex().items_center().justify_center()
      .rounded(16).cursor_pointer().bg(t.foreground).text_color(t.background)
      .hover((el) => el.bg(GREEN).text_color("#000000")).tooltip(s.playing ? `Pause · ${s.title}` : `Play · ${s.title}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.act("toggle", cx))
      .child(svg(ICON(s.playing ? "pause" : "play")).size(14));
    const bar = (state, fill, h, thumb) => Slider.new(state).flex_1().min_w(0).child(
      SliderTrack.new(state).flex().items_center().h(14).w_full().cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(SliderIndicator.new(state).relative().w_full().h(h).rounded(h / 2).bg(t.raised)
          .range_style((el) => el.rounded(h / 2).bg(fill))
          .child(SliderThumb.new(state).size(thumb).rounded(thumb / 2).bg(t.foreground).ml(-thumb / 2))));
    const frame = (el) => measure(el.id(NAME).size_full().overflow_hidden().bg(t.background).border_t(1).border_color(t.border)
      .text_size(12).text_color(t.muted));

    // Folded sidebar: one button.
    if (mode === "rail") {
      const box = frame(div()).flex().items_center().justify_center();
      if (s?.track) return box.child(playBtn());
      return box.child(div().id("hfy-open").size(28).flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.dim).hover((el) => el.bg(t.hover).text_color(t.foreground))
        .tooltip(s?.denied ? "Allow Herdr to control Spotify in System Settings" : "Open Spotify")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => s?.denied ? exec("open", [AUTOMATION]).catch(() => {}) : this.openSpotify(cx))
        .child(svg(ICON("music")).size(14)));
    }

    if (pl && !s?.track) {
      if (!s?.denied) return div(); // nothing to show: the float disappears
      return h_flex().id(NAME).w(pl.vertical ? 260 : 360).px(12).py(10).gap(8).items_center().text_size(12)
        .child(svg(ICON("music")).size(14).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim)
          .tooltip("Herdr may not control Spotify yet. Allow it in System Settings › Privacy & Security › Automation.")
          .child("Spotify needs permission"))
        .child(pill("hfy-settings", "Allow", () => exec("open", [AUTOMATION]).catch(() => {})));
    }

    if (!s?.track) {
      const root = frame(h_flex()).px(mode === "compact" ? 12 : 14).gap(mode === "compact" ? 8 : 16).items_center().justify_center();
      const line = (text, tip) => root
        .child(svg(ICON("music")).size(14).flex_none().text_color(t.dim))
        .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).when(!!tip, (el) => el.tooltip(tip)).child(text));
      if (!s) return line("Looking for Spotify…");
      if (s.denied) {
        const full = "Herdr may not control Spotify yet. Allow it in System Settings › Privacy & Security › Automation.";
        return line(mode === "compact" ? "Spotify needs permission" : full, full)
          .child(pill("hfy-settings", mode === "compact" ? "Allow" : "Open settings", () => exec("open", [AUTOMATION]).catch(() => {})));
      }
      return line(s.off ? (mode === "compact" ? "Spotify is closed" : "Spotify isn't running") : "Nothing playing")
        .child(pill("hfy-open", "Open Spotify", (cx) => this.openSpotify(cx)));
    }

    const shown = this.seekDrag && s.duration ? (this.seek.value() / 1000) * s.duration : this.position();
    const cover = (px) => s.artFile
      ? image(s.artFile).size(px).flex_none().rounded(6)
      : div().size(px).flex_none().rounded(6).bg(t.raised).flex().items_center().justify_center().text_color(t.dim).child(svg(ICON("disc-3")).size(px * 0.42));
    const track = (px, titleSize) => h_flex().id("hfy-track").min_w(0).gap(10).items_center().cursor_pointer()
      .tooltip(`${s.title} · ${s.artist} · ${s.album}\nClick to show Spotify`)
      .when(!pl, (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()))
      .on_click((_e, cx) => this.openSpotify(cx))
      .child(cover(px))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(titleSize).font_medium().text_color(s.playing ? t.foreground : t.muted).child(s.title))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(s.artist)));
    const controls = (gap) => h_flex().gap(gap).items_center().justify_center()
      .child(btn("shuffle", "shuffle", s.shuffle ? "Shuffle on" : "Shuffle off", s.shuffle))
      .child(btn("previous", "skip-back", "Previous"))
      .child(playBtn())
      .child(btn("next", "skip-forward", "Next"))
      .child(btn("repeat", "repeat", s.repeat ? "Repeat on" : "Repeat off", s.repeat));
    const seekRow = (timeW, size) => h_flex().w_full().gap(size < 11 ? 6 : 8).items_center().text_size(size)
      .child(div().w(timeW).flex_none().text_right().text_color(t.dim).child(clock(shown)))
      .child(bar(this.seek, s.playing ? GREEN : t.dim, 4, 10))
      .child(div().w(timeW).flex_none().text_color(t.dim).child(clock(s.duration)));

    const v = this.volDrag ? this.vol.value() : s.volume;
    const volume = (w) => h_flex().flex_none().gap(6).items_center().justify_end()
      .child(div().flex_none().text_color(t.dim).tooltip(`Volume ${Math.round(v)}`)
        .child(svg(ICON(v === 0 ? "volume-x" : v < 50 ? "volume-1" : "volume-2")).size(14)))
      .child(div().w(w).flex_none().child(bar(this.vol, t.muted, 4, 10)));

    if (pl) {
      // Sized by its content; no fill or border of its own (Herdr's frame has them).
      if (pl.vertical) {
        return v_flex().id(NAME).w(260).px(12).py(10).gap(8).text_size(12).text_color(t.muted)
          .child(track(40, 12.5))
          .child(seekRow(30, 10.5))
          .child(controls(4));
      }
      return h_flex().id(NAME).w(760).h(64).px(12).gap(14).items_center().text_size(12).text_color(t.muted)
        .child(track(44, 13).w(220).flex_none())
        .child(v_flex().flex_1().min_w(0).gap(2).items_center()
          .child(controls(6))
          .child(seekRow(34, 10.5)))
        .child(volume(80));
    }

    // Side panel: a stacked card.
    if (mode === "compact") {
      return frame(v_flex()).px(12).py(10).gap(8).justify_center()
        .child(track(40, 12.5))
        .child(seekRow(30, 10.5))
        .child(controls(4));
    }

    // Full width: the bar.
    const narrow = this.width < 720;
    return frame(h_flex()).px(14).gap(16).items_center()
      .child(track(48, 13).w(narrow ? 200 : 280).flex_none())
      .child(v_flex().flex_1().min_w(0).max_w(640).mx_auto().gap(4).items_center()
        .child(controls(8))
        .child(seekRow(38, 11)))
      .child(volume(110).w(narrow ? 0 : 180).when(narrow, (el) => el.hidden()));
  }
}

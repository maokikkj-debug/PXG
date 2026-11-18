const makeTheme = (id, deity, symbol, epithet, image, colors) => ({
  id, deity, symbol, epithet, image: `./theme-${image}.webp`, ...colors,
});

export const THEMES = {
  olympus: makeTheme("olympus", "Olimpo", "✦", "Arquivo do Acampamento", "athena", {
    accent: "#d7b66a", highlight: "#fff0c6", line: "#9c7a3d", surface: "rgba(11, 21, 39, .91)", text: "#f8f1e2", muted: "#c2c9d4", glow: "rgba(215, 182, 106, .28)",
  }),
  athena: makeTheme("athena", "Atena", "🦉", "Sabedoria e estratégia", "athena", {
    accent: "#e5b64f", highlight: "#fff0bd", line: "#b48738", surface: "rgba(15, 22, 34, .9)", text: "#fff4d8", muted: "#d0c3a5", glow: "rgba(234, 184, 69, .32)",
  }),
  poseidon: makeTheme("poseidon", "Poseidon", "♆", "Senhor dos mares", "poseidon", {
    accent: "#28d9df", highlight: "#b7ffff", line: "#00a9b1", surface: "rgba(4, 29, 41, .9)", text: "#e4ffff", muted: "#9acbd1", glow: "rgba(21, 226, 235, .35)",
  }),
  apollo: makeTheme("apollo", "Apolo", "☼", "Luz, música e cura", "apollo", {
    accent: "#df9b25", highlight: "#fff2ae", line: "#c78a25", surface: "rgba(255, 249, 231, .94)", text: "#422c1d", muted: "#79664d", glow: "rgba(245, 177, 49, .3)",
  }),
  hermes: makeTheme("hermes", "Hermes", "☤", "Velocidade e jornadas", "hermes", {
    accent: "#45d9ad", highlight: "#e8c16c", line: "#32987c", surface: "rgba(4, 35, 37, .9)", text: "#edfff8", muted: "#a4cbbd", glow: "rgba(42, 213, 164, .34)",
  }),
  hephaestus: makeTheme("hephaestus", "Hefesto", "⚒", "A forja divina", "hephaestus", {
    accent: "#ff8b36", highlight: "#ffd089", line: "#c4581e", surface: "rgba(34, 20, 15, .91)", text: "#fff1e3", muted: "#c9a28b", glow: "rgba(255, 111, 25, .4)",
  }),
  ares: makeTheme("ares", "Ares", "⚔", "Deus da guerra", "ares", {
    accent: "#ff443d", highlight: "#ffc17a", line: "#b83330", surface: "rgba(31, 15, 18, .92)", text: "#fff0e8", muted: "#c7a6a1", glow: "rgba(255, 54, 45, .38)",
  }),
  zeus: makeTheme("zeus", "Zeus", "ϟ", "Céu e trovão", "zeus", {
    accent: "#39cfff", highlight: "#ffe291", line: "#548ac5", surface: "rgba(9, 24, 46, .9)", text: "#eff8ff", muted: "#a9bfd6", glow: "rgba(52, 176, 255, .38)",
  }),
  hades: makeTheme("hades", "Hades", "☠", "Guardião do submundo", "hades", {
    accent: "#bc82ff", highlight: "#ff958a", line: "#7741a4", surface: "rgba(20, 14, 31, .92)", text: "#f5edff", muted: "#c0b2d0", glow: "rgba(166, 94, 233, .38)",
  }),
};

const deityThemeIds = new Map([
  ["Atena", "athena"], ["Athena", "athena"],
  ["Poseidon", "poseidon"], ["Apolo", "apollo"], ["Apollo", "apollo"],
  ["Hermes", "hermes"], ["Hefesto", "hephaestus"], ["Hephaestus", "hephaestus"],
  ["Ares", "ares"], ["Zeus", "zeus"], ["Hades", "hades"],
]);

export function themeForDeity(deity) {
  const id = deityThemeIds.get(String(deity || "").trim()) || "olympus";
  return THEMES[id];
}

export function themeForCharacter(character) {
  return themeForDeity(character?.parent_deity);
}

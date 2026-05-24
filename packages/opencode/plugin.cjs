async function phasekitOpenCodePlugin(input) {
  const mod = await import("./dist/adapter.js");
  return mod.default(input);
}

module.exports = phasekitOpenCodePlugin;

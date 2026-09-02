const external = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-gateway/client',
  'react',
])

export default {
  name: '@dsh-work/work-api/client',
  entry: { client: '../packages/work-api/client.ts' },
  outDir: '../dist/packages/work-api',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => external.has(specifier),
    alwaysBundle: specifier => !external.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-work/work-api", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

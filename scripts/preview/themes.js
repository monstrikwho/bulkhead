/** VS Code theme variables the webviews use, sampled from Dark Modern and Light Modern. */
export const THEMES = {
  dark: {
    'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
    'font-size': '13px',
    'editor-font-family': 'Menlo, monospace',
    'editor-font-size': '12px',
    foreground: '#cccccc',
    descriptionForeground: '#9d9d9d',
    errorForeground: '#f85149',
    focusBorder: '#0078d4',
    'editor-background': '#1f1f1f',
    'panel-background': '#181818',
    'panel-border': '#2b2b2b',
    'sideBar-background': '#181818',
    'widget-border': '#313131',
    'button-background': '#0078d4',
    'button-hoverBackground': '#026ec1',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#313131',
    'button-secondaryForeground': '#cccccc',
    'list-hoverBackground': '#2a2d2e',
    'list-activeSelectionBackground': '#04395e',
    'list-activeSelectionForeground': '#ffffff',
    'input-background': '#313131',
    'input-foreground': '#cccccc',
    'input-border': '#3c3c3c',
    'input-placeholderForeground': '#989898',
    'textLink-foreground': '#4daafc',
    'textLink-activeForeground': '#4daafc',
    'badge-background': '#616161',
    'badge-foreground': '#f8f8f8',
    'icon-foreground': '#cccccc',
    'toolbar-hoverBackground': '#5a5d5e50',
    'testing-iconPassed': '#73c991',
    'editorLineNumber-foreground': '#6e7681',
    'charts-red': '#f14c4c',
    'statusBarItem-warningBackground': '#9a6700',
    'statusBarItem-errorBackground': '#c72e0f',
    'editorWarning-foreground': '#cca700',
    'debugTokenExpression-number': '#b5cea8',
    'inputValidation-errorBackground': '#5a1d1d',
  },
  light: {
    'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
    'font-size': '13px',
    'editor-font-family': 'Menlo, monospace',
    'editor-font-size': '12px',
    foreground: '#3b3b3b',
    descriptionForeground: '#717171',
    errorForeground: '#f85149',
    focusBorder: '#005fb8',
    'editor-background': '#ffffff',
    'panel-background': '#f8f8f8',
    'panel-border': '#e5e5e5',
    'sideBar-background': '#f8f8f8',
    'widget-border': '#e5e5e5',
    'button-background': '#005fb8',
    'button-hoverBackground': '#0258a8',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#e5e5e5',
    'button-secondaryForeground': '#3b3b3b',
    'list-hoverBackground': '#f2f2f2',
    'list-activeSelectionBackground': '#e8e8e8',
    'list-activeSelectionForeground': '#000000',
    'input-background': '#ffffff',
    'input-foreground': '#3b3b3b',
    'input-border': '#cecece',
    'input-placeholderForeground': '#767676',
    'textLink-foreground': '#005fb8',
    'textLink-activeForeground': '#005fb8',
    'badge-background': '#cccccc',
    'badge-foreground': '#3b3b3b',
    'icon-foreground': '#3b3b3b',
    'toolbar-hoverBackground': '#b8b8b850',
    'testing-iconPassed': '#388a34',
    'editorLineNumber-foreground': '#6e7681',
    'charts-red': '#e51400',
    'statusBarItem-warningBackground': '#9a6700',
    'statusBarItem-errorBackground': '#c72e0f',
    'editorWarning-foreground': '#bf8803',
    'debugTokenExpression-number': '#098658',
    'inputValidation-errorBackground': '#f2dede',
  },
}

export function themeCss(name) {
  const vars = Object.entries(THEMES[name])
    .map(([key, value]) => `--vscode-${key}: ${value};`)
    .join('\n  ')
  return `html {\n  ${vars}\n}`
}

/**
 * The `--orca-*` design tokens an Orca panel gets, sampled from Orca's light and dark themes.
 * Orca writes them into `<style id="orca-design-tokens">:root{…}</style>` and puts `light` or
 * `dark` on <html>; the panel maps them to `--vscode-*` itself (packages/webview/src/orca).
 */
export const ORCA_THEMES = {
  dark: {
    background: '#0a0a0a',
    foreground: '#f0f0f0',
    card: '#171717',
    'card-foreground': '#f0f0f0',
    popover: '#171717',
    'popover-foreground': '#f0f0f0',
    primary: '#e5e5e5',
    'primary-foreground': '#171717',
    secondary: '#262626',
    'secondary-foreground': '#f0f0f0',
    muted: '#262626',
    'muted-foreground': '#acacac',
    accent: '#404040',
    'accent-foreground': '#f0f0f0',
    destructive: '#ff6568',
    'destructive-foreground': '#450a0a',
    border: '#ffffff12',
    input: '#ffffff26',
    ring: '#737373',
    radius: '.625rem',
  },
  light: {
    background: '#fff',
    foreground: '#0a0a0a',
    card: '#fff',
    'card-foreground': '#0a0a0a',
    popover: '#fff',
    'popover-foreground': '#0a0a0a',
    primary: '#171717',
    'primary-foreground': '#fafafa',
    secondary: '#f5f5f5',
    'secondary-foreground': '#171717',
    muted: '#f5f5f5',
    'muted-foreground': '#696969',
    accent: '#f5f5f5',
    'accent-foreground': '#171717',
    destructive: '#e40014',
    'destructive-foreground': '#fff',
    border: '#e5e5e5',
    input: '#e5e5e5',
    ring: '#a1a1a1',
    radius: '.625rem',
  },
}

/** What Orca injects into a panel document, without the `<style>` tag. */
export function orcaThemeCss(name) {
  const vars = Object.entries(ORCA_THEMES[name])
    .map(([key, value]) => `--orca-${key}:${value}`)
    .join(';')
  return `:root{${vars}}:where(html.light){color-scheme:light}:where(html.dark){color-scheme:dark}`
}

import { randomUUID } from 'node:crypto'

import {
  ConfigError,
  parseConnectionProfile,
  type ConnectionProfile,
  type Driver,
  type OptionField,
} from '@bulkhead/core'
import * as vscode from 'vscode'

import { drivers } from '../drivers'
import type { SecretVault } from './secrets'

/** Collects a profile step by step; returns `undefined` if the user backs out at any step. */
export async function connectionWizard(
  secrets: SecretVault,
  existing?: ConnectionProfile,
): Promise<ConnectionProfile | undefined> {
  const title = existing
    ? vscode.l10n.t('Edit connection "{0}"', existing.name)
    : vscode.l10n.t('Add connection')

  const name = await vscode.window.showInputBox({
    title,
    prompt: vscode.l10n.t('Connection name'),
    value: existing?.name,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('Required')),
  })
  if (name === undefined) return undefined

  const driver = existing ? drivers.get(existing.driver) : await pickDriver(title)
  if (!driver) return undefined

  const options: Record<string, unknown> = {}
  for (const field of driver.optionFields) {
    const value = await askOption(title, field, existing?.options[field.key])
    if (value === cancelled) return undefined
    if (value !== undefined) options[field.key] = value
  }
  // Keep options the form does not show (e.g. edited by hand in settings.json).
  const mergedOptions = { ...existing?.options, ...options }

  const environment = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t('Development'),
        description: vscode.l10n.t('Reads and writes'),
        production: false,
      },
      {
        label: vscode.l10n.t('$(shield) Production'),
        description: vscode.l10n.t('Read-only until writes are explicitly unlocked; highlighted'),
        production: true,
      },
    ],
    { title, placeHolder: vscode.l10n.t('Environment'), ignoreFocusOut: true },
  )
  if (!environment) return undefined

  let profile: ConnectionProfile
  try {
    driver.parseOptions(mergedOptions)
    profile = parseConnectionProfile({
      ...existing,
      id: existing?.id ?? randomUUID(),
      name: name.trim(),
      driver: driver.kind,
      production: environment.production,
      options: mergedOptions,
    })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    void vscode.window.showErrorMessage(vscode.l10n.t('Invalid connection: {0}', error.message))
    return undefined
  }

  for (const field of driver.secretFields) {
    const value = await vscode.window.showInputBox({
      title,
      prompt: existing
        ? vscode.l10n.t('{0} — leave empty to keep the saved value', field.label)
        : field.label,
      password: true,
      ignoreFocusOut: true,
    })
    if (value === undefined) return undefined
    if (value !== '' || !existing) await secrets.set(profile.id, field.key, value)
  }

  return profile
}

async function pickDriver(title: string): Promise<Driver | undefined> {
  const all = [...drivers.values()]
  if (all.length === 1) return all[0]
  const picked = await vscode.window.showQuickPick(
    all.map((driver) => ({ label: driver.displayName, driver })),
    { title, placeHolder: vscode.l10n.t('Database type'), ignoreFocusOut: true },
  )
  return picked?.driver
}

const cancelled = Symbol('cancelled')

async function askOption(title: string, field: OptionField, current: unknown): Promise<unknown> {
  if (field.kind === 'enum' || field.kind === 'boolean') {
    const values = field.kind === 'enum' ? field.values : ['true', 'false']
    const selected = scalarText(current) ?? String(field.default ?? values[0])
    const picked = await vscode.window.showQuickPick(
      values.map((value) => ({ label: value, picked: value === selected })),
      { title, placeHolder: field.label, ignoreFocusOut: true },
    )
    if (!picked) return cancelled
    return field.kind === 'boolean' ? picked.label === 'true' : picked.label
  }

  const value = await vscode.window.showInputBox({
    title,
    prompt: field.label,
    placeHolder: field.placeholder,
    value: scalarText(current) ?? field.default?.toString() ?? '',
    ignoreFocusOut: true,
    validateInput: (input) => {
      if (field.required && !input.trim()) return vscode.l10n.t('Required')
      if (field.kind === 'number' && input.trim() && !Number.isFinite(Number(input))) {
        return vscode.l10n.t('Must be a number')
      }
      return undefined
    },
  })
  if (value === undefined) return cancelled
  if (!value.trim()) return undefined
  return field.kind === 'number' ? Number(value) : value.trim()
}

/** Text of a value hand-edited in settings.json, or `undefined` if it is not a scalar. */
function scalarText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined
}

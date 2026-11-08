import type { WelcomeAction } from '@bulkhead/core'

import { Icon, type IconName } from './icons'
import { hostActions, post, tableHint } from './vscode'

const CARDS: { action: WelcomeAction; icon: IconName; label: string; primary?: boolean }[] = [
  { action: 'new-connection', icon: 'plus', label: 'New Connection', primary: true },
  { action: 'new-query', icon: 'newFile', label: 'New Query' },
  { action: 'open-sql-file', icon: 'folder', label: 'Open SQL File' },
  { action: 'connect-agent', icon: 'sparkle', label: 'Connect an AI Agent' },
]

const LINKS: { action: WelcomeAction; icon: IconName; label: string }[] = [
  { action: 'docs', icon: 'book', label: 'Documentation' },
  { action: 'issues', icon: 'bug', label: 'Issues & Requests' },
  { action: 'changelog', icon: 'star', label: "What's New" },
]

/** The results panel before the first run: what to do next, one click away. */
export function Welcome() {
  const act = (action: WelcomeAction) => post({ type: 'action', action })
  return (
    <div className="welcome">
      <div className="welcome-cards">
        {CARDS.filter((card) => hostActions.includes(card.action)).map((card) => (
          <button
            type="button"
            key={card.action}
            className={card.primary ? 'welcome-card primary' : 'welcome-card'}
            onClick={() => act(card.action)}
          >
            <span className="welcome-icon">
              <Icon name={card.icon} size={18} />
            </span>
            {card.label}
          </button>
        ))}
      </div>
      <div className="welcome-links">
        {LINKS.map((link) => (
          <button
            type="button"
            key={link.action}
            className="welcome-link"
            onClick={() => act(link.action)}
          >
            <Icon name={link.icon} />
            {link.label}
          </button>
        ))}
      </div>
      <p className="welcome-hint">
        Run a query with <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd>. {tableHint}
      </p>
    </div>
  )
}

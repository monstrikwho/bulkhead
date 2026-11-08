import { PANEL, parseTableFile, type RunRequest } from '@bulkhead/core'
import { useEffect, useState } from 'react'

import { App } from '../App'
import { orcaFrame } from './bridge'
import { call, messageOf, Questions, Tooltips } from './shared'

/**
 * A table's data in an Orca editor tab (a `.bhtable` file the worker wrote on "Open data"):
 * runs the file's query on open and whenever the file changes, like VS Code's table tabs. The
 * refresh button of the results header asks the worker to run it again.
 */
export function TableApp() {
  const [problem, setProblem] = useState<string | undefined>(() =>
    orcaFrame().document ? undefined : 'This tab has no document.',
  )

  useEffect(() => {
    const document = orcaFrame().document
    if (!document) return
    let last: string | undefined
    const subscription = document.onDidChange(({ content }) => {
      if (content.kind !== 'text' || content.text === last) return
      last = content.text
      const file = parseTableFile(content.text)
      if (!file) {
        setProblem('This is not a Bulkhead table file. Open the table again from Connections.')
        return
      }
      if (!file.query) {
        setProblem(file.notice ?? 'There is nothing to show for this table.')
        return
      }
      setProblem(undefined)
      const request: RunRequest = {
        connectionId: file.connectionId,
        text: file.query,
        mode: 'script',
        ...(file.database ? { database: file.database } : {}),
        ...(file.notice ? { notice: file.notice } : {}),
      }
      call(PANEL.run, request).catch((failure: unknown) => setProblem(messageOf(failure)))
    })
    return () => subscription.dispose()
  }, [])

  return (
    <div className="oa-root">
      {problem ? (
        <div className="error-box" role="alert">
          {problem}
        </div>
      ) : (
        <App variant="table" />
      )}
      <Questions />
      <Tooltips />
    </div>
  )
}

export type WindowCloseAction = 'hide' | 'quit'

export function windowCloseAction(allowQuit: boolean, activeAgent: boolean): WindowCloseAction {
  return !allowQuit && activeAgent ? 'hide' : 'quit'
}

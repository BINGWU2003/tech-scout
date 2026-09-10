import '@tanstack/history'

declare module '@tanstack/history' {
  interface HistoryState {
    libraryDetail?: {
      kind: 'companies' | 'patents'
      id: string
    }
  }
}

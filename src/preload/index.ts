import { contextBridge, ipcRenderer } from 'electron'

const api = {
  pickImage: (): Promise<string | null> => ipcRenderer.invoke('doclocal:pickImage'),

  loadModel: (onProgress: (pct: number) => void): Promise<{ modelId: string; loadTimeMs: number }> => {
    const listener = (_event: unknown, pct: number): void => onProgress(pct)
    ipcRenderer.on('doclocal:modelProgress', listener)
    return ipcRenderer.invoke('doclocal:loadModel').finally(() => {
      ipcRenderer.removeListener('doclocal:modelProgress', listener)
    })
  },

  extract: (
    imagePath: string,
    docType: string,
    onPlan: (fields: { key: string; label: string }[]) => void,
    onFieldStart: (key: string) => void,
    onFieldDone: (key: string, value: string) => void,
    onToken?: (token: string) => void,
    onNetworkCount?: (count: number) => void
  ): Promise<{ fields: Record<string, string>; stats: unknown; networkEventsDuring: number }> => {
    const planListener = (_event: unknown, fields: { key: string; label: string }[]): void => onPlan(fields)
    const startListener = (_event: unknown, key: string): void => onFieldStart(key)
    const doneListener = (_event: unknown, key: string, value: string): void => onFieldDone(key, value)
    const tokenListener = (_event: unknown, token: string): void => onToken?.(token)
    const networkCountListener = (_event: unknown, count: number): void => onNetworkCount?.(count)
    ipcRenderer.on('doclocal:extractPlan', planListener)
    ipcRenderer.on('doclocal:extractFieldStart', startListener)
    ipcRenderer.on('doclocal:extractFieldDone', doneListener)
    ipcRenderer.on('doclocal:extractToken', tokenListener)
    ipcRenderer.on('doclocal:networkCount', networkCountListener)
    return ipcRenderer.invoke('doclocal:extract', imagePath, docType).finally(() => {
      ipcRenderer.removeListener('doclocal:extractPlan', planListener)
      ipcRenderer.removeListener('doclocal:extractFieldStart', startListener)
      ipcRenderer.removeListener('doclocal:extractFieldDone', doneListener)
      ipcRenderer.removeListener('doclocal:extractToken', tokenListener)
      ipcRenderer.removeListener('doclocal:networkCount', networkCountListener)
    })
  },

  explain: (
    fields: Record<string, string>,
    onToken: (token: string) => void
  ): Promise<{ text: string; stats: unknown; networkEventsDuring: number }> => {
    const listener = (_event: unknown, token: string): void => onToken(token)
    ipcRenderer.on('doclocal:explainToken', listener)
    return ipcRenderer.invoke('doclocal:explain', fields).finally(() => {
      ipcRenderer.removeListener('doclocal:explainToken', listener)
    })
  },

  getPerfLog: (): Promise<unknown[]> => ipcRenderer.invoke('doclocal:getPerfLog'),
  getNetworkEvents: (): Promise<unknown[]> => ipcRenderer.invoke('doclocal:getNetworkEvents'),
  clearNetworkEvents: (): Promise<void> => ipcRenderer.invoke('doclocal:clearNetworkEvents')
}

contextBridge.exposeInMainWorld('doclocal', api)

export type DoclocalApi = typeof api

import { session } from 'electron'

/**
 * Prueba de privacidad en vivo: cuenta cada request de red que sale del
 * proceso de Electron. Se usa para mostrar en la UI "0 bytes salientes"
 * durante la inferencia — la promesa de soberanía de datos del hackathon,
 * hecha verificable en lugar de ser solo una afirmación en el README.
 *
 * file:// y devtools no cuentan como "salida a la red". Todo lo demás sí,
 * incluida la descarga puntual de pesos del modelo la primera vez que se
 * usa un modelo nuevo (eso se ve reflejado también, para que quede claro
 * que ocurrió y cuándo).
 */

export type NetworkEvent = {
  ts: string
  url: string
  method: string
}

const events: NetworkEvent[] = []
let listening = false

function isLocal(url: string): boolean {
  return (
    url.startsWith('file://') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('data:')
  )
}

export function startNetworkMonitor(): void {
  if (listening) return
  listening = true
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!isLocal(details.url)) {
      events.push({ ts: new Date().toISOString(), url: details.url, method: details.method })
      if (events.length > 500) events.shift()
    }
    callback({})
  })
}

export function getNetworkEvents(): NetworkEvent[] {
  return events
}

export function countEventsSince(sinceIso: string): number {
  const sinceMs = new Date(sinceIso).getTime()
  return events.filter((e) => new Date(e.ts).getTime() >= sinceMs).length
}

export function clearNetworkEvents(): void {
  events.length = 0
}

import type { PerfEntry } from '../types'

function fmt(n: number | undefined, suffix = ''): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100) / 100}${suffix}`
}

export default function PerfPanel({ entries }: { entries: PerfEntry[] }): JSX.Element {
  // "Explicar en lenguaje simple" ya no llama al modelo (ver qvac.ts) --
  // registra un evento sin tokens/throughput. Si tomáramos siempre el
  // último evento a secas, el panel se "vaciaría" en cuanto el usuario
  // pide la explicación. En vez de eso, mostramos el último evento que sí
  // tiene métricas reales de inferencia, para que los números de la
  // extracción se queden visibles.
  const last = [...entries].reverse().find((e) => e.generatedTokens !== undefined) ?? entries[entries.length - 1]
  return (
    <div className="perf-panel">
      <div className="perf-panel__header">Rendimiento del modelo (VisionPsy-Nano-460M, on-device)</div>
      {last ? (
        <div className="perf-grid">
          <div className="perf-cell">
            <div className="perf-label">TTFT</div>
            <div className="perf-value">{fmt(last.timeToFirstTokenMs, ' ms')}</div>
          </div>
          <div className="perf-cell">
            <div className="perf-label">Throughput</div>
            <div className="perf-value">{fmt(last.tokensPerSecond, ' tok/s')}</div>
          </div>
          <div className="perf-cell">
            <div className="perf-label">Tokens prompt</div>
            <div className="perf-value">{fmt(last.promptTokens)}</div>
          </div>
          <div className="perf-cell">
            <div className="perf-label">Tokens generados</div>
            <div className="perf-value">{fmt(last.generatedTokens)}</div>
          </div>
          <div className="perf-cell">
            <div className="perf-label">Backend</div>
            <div className="perf-value">{last.backendDevice ?? '—'}</div>
          </div>
          <div className="perf-cell">
            <div className="perf-label">Tiempo total</div>
            <div className="perf-value">{fmt(last.wallTimeMs, ' ms')}</div>
          </div>
        </div>
      ) : (
        <div className="perf-empty">Corre una extracción para ver métricas en vivo.</div>
      )}
      <details className="perf-log">
        <summary>Log estructurado completo ({entries.length} eventos)</summary>
        <pre>{JSON.stringify(entries, null, 2)}</pre>
      </details>
    </div>
  )
}

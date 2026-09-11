import { useCallback, useEffect, useMemo, useState } from 'react'
import PrivacyBadge from './components/PrivacyBadge'
import PerfPanel from './components/PerfPanel'
import {
  DOC_TYPE_ICONS,
  DOC_TYPE_LABELS,
  DOC_TYPE_OPTIONS,
  type FieldDef,
  type PerfEntry,
  type SelectableDocType,
  type Stage
} from './types'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loadingModel')
  const [modelProgress, setModelProgress] = useState(0)
  const [docType, setDocType] = useState<SelectableDocType | null>(null)
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldPlan, setFieldPlan] = useState<FieldDef[]>([])
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [explanationText, setExplanationText] = useState('')
  const [perfEntries, setPerfEntries] = useState<PerfEntry[]>([])
  const [netEventsDuringLastOp, setNetEventsDuringLastOp] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    window.doclocal
      .loadModel((pct) => setModelProgress(pct))
      .then(async () => {
        setStage('idle')
        setPerfEntries((await window.doclocal.getPerfLog()) as PerfEntry[])
      })
      .catch((err) => {
        setErrorMsg(String(err?.message ?? err))
        setStage('error')
      })
  }, [])

  const handleSelectDocType = useCallback((type: SelectableDocType) => {
    setDocType(type)
    setImagePath(null)
    setFields({})
    setFieldPlan([])
    setExplanationText('')
    setNetEventsDuringLastOp(null)
    setPendingKey(null)
    setStage((prev) => (prev === 'loadingModel' ? prev : 'idle'))
  }, [])

  const handlePickImage = useCallback(async () => {
    if (!docType) return
    const path = await window.doclocal.pickImage()
    if (!path) return
    setImagePath(path)
    // El tipo de documento ya lo eligió el usuario arriba -- se guarda de
    // una vez en los campos, igual que hacía antes la pregunta de
    // clasificación al modelo (ver comentario en src/main/qvac.ts).
    setFields({ tipo_documento: docType })
    setFieldPlan([])
    setExplanationText('')
    setNetEventsDuringLastOp(null)
    setPendingKey(null)
    setStage('extracting')
    try {
      const { stats, networkEventsDuring } = await window.doclocal.extract(
        path,
        docType,
        (plan) => {
          setFieldPlan(plan)
        },
        (key) => {
          setPendingKey(key)
        },
        (key, value) => {
          setFields((prev) => ({ ...prev, [key]: value }))
          setPendingKey(null)
        },
        undefined,
        // Actualiza el indicador de privacidad EN VIVO mientras corre la
        // extracción (no solo una vez al final) -- ver comentario en
        // src/main/index.ts sobre por qué se emite en cada paso de campo.
        (count) => setNetEventsDuringLastOp(count)
      )
      setPerfEntries((prev) => [...prev, stats as PerfEntry])
      setNetEventsDuringLastOp(networkEventsDuring)
      setStage('extracted')
    } catch (err: any) {
      setErrorMsg(String(err?.message ?? err))
      setStage('error')
    }
  }, [docType])

  const handleExplain = useCallback(async () => {
    setStage('explaining')
    setExplanationText('')
    try {
      const { stats, networkEventsDuring } = await window.doclocal.explain(fields, (token) => {
        setExplanationText((prev) => prev + token)
      })
      setPerfEntries((prev) => [...prev, stats as PerfEntry])
      setNetEventsDuringLastOp((prev) => (prev ?? 0) + networkEventsDuring)
      setStage('done')
    } catch (err: any) {
      setErrorMsg(String(err?.message ?? err))
      setStage('error')
    }
  }, [fields])

  const tipoLabel = docType ? DOC_TYPE_LABELS[docType] : null
  const tipoIcon = docType ? DOC_TYPE_ICONS[docType] : '📄'
  const hasAnyField = fieldPlan.some(({ key }) => fields[key])
  const isExtractingActive = stage === 'extracting' || stage === 'extracted' || stage === 'explaining' || stage === 'done'

  // Paso activo del wizard de la barra lateral, derivado del estado general
  // de la app — no es un estado propio, para que nunca se desincronice.
  const activeStep = stage === 'explaining' || stage === 'done' ? 3 : stage === 'extracting' || stage === 'extracted' ? 2 : 1
  const step1Done = activeStep > 1
  const step2Done = activeStep > 2 || stage === 'done'
  const step3Done = stage === 'done'

  const steps = useMemo(
    () => [
      { n: 1, label: 'Documento', sub: 'Selecciona la imagen', done: step1Done },
      { n: 2, label: 'Extracción', sub: 'Campos estructurados', done: step2Done },
      { n: 3, label: 'Explicación', sub: 'Lenguaje simple', done: step3Done }
    ],
    [step1Done, step2Done, step3Done]
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__mark">V</span>
          <div className="sidebar__brand-text">
            {/* "Vanguard Edge Local Vision" completo no entra en una línea en
                la barra lateral angosta -- se muestra la sigla acá, y el
                nombre completo queda en el título de la ventana, el README
                y el guion de demo. */}
            <span className="sidebar__name">VELV</span>
            <span className="sidebar__tagline">Vanguard Edge Local Vision</span>
          </div>
        </div>

        <nav className="stepper">
          {steps.map((s) => (
            <div
              key={s.n}
              className={`stepper__item${activeStep === s.n ? ' is-active' : ''}${s.done ? ' is-done' : ''}`}
            >
              <span className="stepper__icon">{s.done ? '✓' : s.n}</span>
              <div className="stepper__text">
                <span className="stepper__label">{s.label}</span>
                <span className="stepper__sub">{s.sub}</span>
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        <div className="sidebar__privacy">
          <PrivacyBadge netEventsDuringLastOp={netEventsDuringLastOp} />
        </div>
      </aside>

      <div className="main">
        <div className="main__grid">
          <section className="card card--upload">
            <h2>
              <span className="card__step">1</span>Documento
            </h2>
            {stage === 'loadingModel' && (
              <div className="loading-block">
                <div className="progress-bar">
                  <div className="progress-bar__fill" style={{ width: `${modelProgress}%` }} />
                </div>
                <p>Cargando VisionPsy-Nano-460M localmente… {modelProgress}%</p>
              </div>
            )}

            {stage !== 'loadingModel' && (
              <>
                <p className="doc-type-select__label">¿Qué documento vas a leer?</p>
                <div className="doc-type-select">
                  {DOC_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`doc-type-option${docType === opt.value ? ' is-selected' : ''}`}
                      onClick={() => handleSelectDocType(opt.value)}
                      disabled={stage === 'extracting'}
                    >
                      <span className="doc-type-option__icon" aria-hidden>
                        {opt.icon}
                      </span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>

                <button
                  className="btn btn--primary"
                  onClick={handlePickImage}
                  disabled={stage === 'extracting' || !docType}
                >
                  {imagePath ? 'Cambiar imagen…' : 'Seleccionar imagen del documento…'}
                </button>
                <p className="hint">
                  {docType
                    ? 'Elige el tipo de documento arriba para habilitar la selección de imagen.'
                    : 'Elige el tipo de documento arriba para habilitar la selección de imagen.'}
                </p>
              </>
            )}
          </section>

          <div className="main__col-right">
            <section className="card card--result">
              <h2>
                <span className="card__step">2</span>Extracción estructurada
              </h2>
              {stage === 'idle' && <p className="hint">Selecciona un documento para comenzar.</p>}

              {isExtractingActive && (
                <>
                  <div className="extracted-card">
                    <div className="extracted-card__type">
                      <span className="doc-type-icon" aria-hidden>
                        {tipoIcon}
                      </span>
                      <span>{tipoLabel ?? 'Documento'}</span>
                    </div>

                    {fieldPlan.length > 0 && (
                      <dl className="fields">
                        {fieldPlan.map(({ key, label }) => {
                          const value = fields[key]
                          const isPending = pendingKey === key
                          if (!value && !isPending) {
                            return (
                              <div className="fields__row fields__row--waiting" key={key}>
                                <dt>{label}</dt>
                                <dd>—</dd>
                              </div>
                            )
                          }
                          if (isPending) {
                            return (
                              <div className="fields__row fields__row--pending" key={key}>
                                <dt>{label}</dt>
                                <dd>
                                  <span className="field-spinner" />
                                  leyendo…
                                </dd>
                              </div>
                            )
                          }
                          if (value === 'no_visible') {
                            return (
                              <div className="fields__row fields__row--empty" key={key}>
                                <dt>{label}</dt>
                                <dd>no visible en el documento</dd>
                              </div>
                            )
                          }
                          return (
                            <div className="fields__row" key={key}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          )
                        })}
                      </dl>
                    )}
                  </div>

                  {stage === 'extracted' && hasAnyField && (
                    <button className="btn btn--secondary" onClick={handleExplain}>
                      Explicar en lenguaje simple
                    </button>
                  )}
                </>
              )}
            </section>

            <section className="card card--explain">
              <h2>
                <span className="card__step">3</span>Explicación para el cliente
              </h2>
              {(stage === 'explaining' || stage === 'done') && (
                <p className="explanation-text">{explanationText || '…'}</p>
              )}
              {stage !== 'explaining' && stage !== 'done' && (
                <p className="hint">Aparece después de extraer los datos del documento.</p>
              )}
            </section>
          </div>
        </div>

        <footer className="perf-strip">
          <PerfPanel entries={perfEntries} />
        </footer>
      </div>

      {errorMsg && (
        <div className="error-toast">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}
    </div>
  )
}

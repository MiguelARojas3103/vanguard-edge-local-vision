import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { loadModel, unloadModel, completion, getSystemResources } from '@qvac/sdk'

/**
 * Descarga directa por HTTPS desde Hugging Face, en vez del registro P2P
 * (Hypercore/Hyperswarm) que usan las constantes `VISIONPSY_NANO_460M_...`
 * del SDK. En pruebas reales, el registro P2P dio timeout tanto en red
 * universitaria como en red doméstica (REQUEST_TIMEOUT) — es una capa muy
 * nueva del SDK (v0.19). El propio error de QVAC sugiere pasar una fuente
 * alternativa; estas URLs son las mismas que resuelve la constante oficial
 * `VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M` / `MMPROJ_..._Q8_0` internamente
 * (verificado leyendo node_modules/@qvac/inference/dist/models/registry).
 * La inferencia en sí sigue siendo 100% local — esto solo cambia CÓMO se
 * bajan los pesos una vez, no dónde corre el modelo.
 */
const VISIONPSY_MODEL_URL =
  'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/a24fb9cdd1119406b15ff60b06a51f8438a931c1/visionpsy-nano-460m-flash-q4_k_m-imat.gguf'
const VISIONPSY_MMPROJ_URL =
  'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/a24fb9cdd1119406b15ff60b06a51f8438a931c1/mmproj-visionpsy-nano-460m-flash-q8.gguf'

/**
 * Todo lo relacionado a QVAC vive acá: carga del modelo VisionPsy, extracción
 * estructurada de documentos, explicación en lenguaje simple, y el registro
 * de rendimiento estructurado que exige el Track 02 (QVAC Psy).
 *
 * Requisito técnico (art. 10 de las bases): la inferencia corre 100% en el
 * dispositivo vía @qvac/sdk. Este módulo nunca hace fetch/http hacia un
 * endpoint de inferencia en la nube — lo único que puede tocar red es la
 * descarga inicial de los pesos del modelo (no es inferencia), y eso ocurre
 * una sola vez y queda cacheado localmente.
 */

export type PerfLogEntry = {
  ts: string
  op: 'loadModel' | 'extract' | 'explain'
  modelId?: string
  hardware?: string
  promptTokens?: number
  generatedTokens?: number
  timeToFirstTokenMs?: number
  tokensPerSecond?: number
  backendDevice?: 'cpu' | 'gpu'
  wallTimeMs?: number
}

let modelId: string | null = null
let modelLoadedAt: number | null = null
let modelLoadPromise: Promise<{ modelId: string; loadTimeMs: number }> | null = null
const perfLog: PerfLogEntry[] = []

function perfLogPath(): string {
  const dir = join(app.getPath('userData'), 'performance-logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'perf-log.jsonl')
}

function recordPerf(entry: PerfLogEntry): void {
  perfLog.push(entry)
  try {
    appendFileSync(perfLogPath(), JSON.stringify(entry) + '\n')
  } catch {
    // Si el disco falla, seguimos igual: el log en memoria alimenta la UI.
  }
}

export function getPerfLog(): PerfLogEntry[] {
  return perfLog
}

export async function getHardwareLabel(): Promise<string> {
  try {
    const resources = await getSystemResources({ sample: false })
    const cpu = (resources as any)?.capabilities?.cpu?.model?.value
    const mem = (resources as any)?.capabilities?.memory?.totalBytes?.value
    const memGb = typeof mem === 'number' ? `${Math.round(mem / 1024 / 1024 / 1024)}GB RAM` : ''
    return [cpu, memGb, process.platform, process.arch].filter(Boolean).join(' · ')
  } catch {
    return `${process.platform} ${process.arch}`
  }
}

/**
 * Idempotente y a prueba de llamadas concurrentes: si ya hay una carga en
 * curso (por ejemplo, el doble montaje de React.StrictMode en desarrollo,
 * que invoca efectos dos veces a propósito), la segunda llamada reutiliza
 * la misma promesa en vez de pedirle al worker de QVAC que registre el
 * mismo modelo dos veces (eso producía MODEL_LOAD_FAILED: "already
 * registered").
 */
export async function ensureModelLoaded(
  onProgress?: (pct: number) => void
): Promise<{ modelId: string; loadTimeMs: number }> {
  if (modelId) {
    return { modelId, loadTimeMs: 0 }
  }
  if (modelLoadPromise) {
    return modelLoadPromise
  }

  modelLoadPromise = (async () => {
    const hardware = await getHardwareLabel()
    const start = Date.now()
    const id = await loadModel({
      modelSrc: VISIONPSY_MODEL_URL,
      modelType: 'llamacpp-completion',
      modelConfig: {
        ctx_size: 4096,
        projectionModelSrc: VISIONPSY_MMPROJ_URL
      },
      onProgress: (progress) => {
        if (onProgress && typeof progress?.percentage === 'number') {
          onProgress(progress.percentage)
        }
      }
    })
    const loadTimeMs = Date.now() - start
    modelId = id
    modelLoadedAt = Date.now()
    recordPerf({
      ts: new Date().toISOString(),
      op: 'loadModel',
      modelId: id,
      hardware,
      wallTimeMs: loadTimeMs
    })
    return { modelId: id, loadTimeMs }
  })().finally(() => {
    modelLoadPromise = null
  })

  return modelLoadPromise
}

// VisionPsy-Nano-460M es un modelo muy pequeño (460M parámetros). En pruebas
// reales, pedirle un JSON completo de 6+ campos en una sola respuesta libre
// fue poco confiable: unas veces repetía el ejemplo del prompt en vez de
// mirar la imagen real, otras mezclaba el formato JSON con la respuesta.
// Un modelo tan chico responde mucho mejor a UNA pregunta puntual y corta
// por campo que a generar una estructura completa de una vez. Por eso la
// extracción se hace campo por campo: una llamada a completion() por campo,
// siempre con la misma imagen adjunta, sin JSON de por medio — el objeto
// estructurado se arma acá en código a partir de las respuestas, nunca
// parseando texto libre del modelo.
//
// Los 3 tipos de documento que acepta la app (cédula, comprobante de
// domicilio, formulario de apertura de cuenta) NO comparten los mismos
// campos relevantes: una cédula no tiene "tipo de cuenta", un comprobante
// de domicilio no tiene "fecha de nacimiento". Por eso, después de
// clasificar el tipo de documento (primer campo, siempre igual), el resto
// de las preguntas se eligen dinámicamente según ese tipo.
// Antes, el tipo de documento lo "adivinaba" el propio modelo con una
// pregunta de clasificación (comparar la imagen contra 4 categorías). En
// pruebas reales sobre hardware real esto resultó poco confiable: un modelo
// de 460M parámetros no sostiene bien una tarea de clasificación/comparación
// -- en vez de responder una palabra, a veces se ponía a "razonar" en texto
// libre sobre el enunciado de la pregunta (incluso en inglés), ignorando la
// imagen. Ya se intentaron dos rondas de ajuste de prompt sin éxito.
//
// La solución confiable: el tipo de documento lo elige el usuario (el
// agente bancario) ANTES de subir la imagen, con 3 botones en la UI. Esto
// no le quita nada al producto -- en un flujo real el agente siempre sabe
// qué documento está escaneando -- y elimina por completo el único paso
// donde el modelo fallaba, dejando que se dedique a lo que sí hace bien:
// responder una pregunta puntual por campo sobre una imagen.
export type DocType = 'cedula' | 'comprobante_domicilio' | 'formulario_apertura_cuenta' | 'otro'

export type FieldDef = { key: string; label: string; prompt: string }

const FIELD_SETS: Record<DocType, FieldDef[]> = {
  cedula: [
    {
      key: 'nombre',
      label: 'Nombre',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es el nombre completo de la persona escrito en esta cédula? Responde solamente con el nombre, copiado tal como aparece impreso, sin agregar nada más. Si no ves ningún nombre en la imagen, responde exactamente: no_visible'
    },
    {
      key: 'numero_documento',
      label: 'Número de cédula',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es el número de cédula o identificación escrito en la imagen? Responde solamente con ese número, copiado tal como aparece impreso, sin agregar nada más. Si no ves ningún número en la imagen, responde exactamente: no_visible'
    },
    {
      key: 'fecha_nacimiento',
      label: 'Fecha de nacimiento',
      prompt:
        'Mira la imagen adjunta. ¿Aparece una fecha de nacimiento en esta cédula? Responde solamente con esa fecha, copiada tal como aparece impresa, sin agregar nada más. Si no ves ninguna fecha de nacimiento en la imagen, responde exactamente: no_visible'
    },
    {
      key: 'direccion',
      label: 'Dirección',
      prompt:
        'Mira la imagen adjunta. ¿Aparece una DIRECCIÓN FÍSICA (calle, avenida, urbanización, número de casa o apartamento, sector, corregimiento) escrita en esta cédula? Una fecha, un número de cédula o una fecha de expedición NO son una dirección — ignóralas. Si ves una dirección física real, respóndela copiada tal como aparece impresa, sin agregar nada más. La mayoría de las cédulas no incluyen domicilio. Si no ves ninguna dirección física, responde exactamente: no_visible'
    }
  ],
  comprobante_domicilio: [
    {
      key: 'nombre_titular',
      label: 'Nombre del titular',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es el nombre completo del titular o cliente que aparece en este comprobante de domicilio (factura de luz, agua, teléfono u otro servicio)? Responde solamente con el nombre, copiado tal como aparece impreso, sin agregar nada más. Si no ves ningún nombre, responde exactamente: no_visible'
    },
    {
      key: 'direccion',
      label: 'Dirección',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es la DIRECCIÓN FÍSICA completa (calle, avenida, urbanización, número de casa o apartamento, piso, sector, corregimiento) del servicio, que aparece en este comprobante de domicilio? Suele ser la línea o el bloque de texto más largo del documento. Una fecha (como "05/AGO/2026") NO es una dirección — ignórala. El nombre de una empresa tampoco es una dirección. Responde solamente con la dirección completa, copiada tal como aparece impresa, sin agregar nada más. Si no ves ninguna dirección, responde exactamente: no_visible'
    },
    {
      key: 'empresa_emisora',
      label: 'Empresa emisora',
      prompt:
        'Mira la imagen adjunta. ¿Qué empresa o entidad emitió este comprobante (por ejemplo, una empresa de electricidad, agua, teléfono o cable)? El nombre completo de la empresa casi siempre está escrito en letras GRANDES en la parte de ARRIBA del documento, junto a un logo. Copia el nombre COMPLETO tal como aparece, con todas sus palabras (por ejemplo "Energía Panamá, S.A." completo, no solo "S.A." ni solo la parte final) — nunca respondas solamente un sufijo legal como "S.A." o "S.R.L." sin el resto del nombre. Eso NO es una dirección ni un corregimiento — ignora esas partes. Responde solamente con el nombre completo de esa empresa, copiado tal como aparece impreso, sin agregar nada más. Si no ves el nombre de ninguna empresa, responde exactamente: no_visible'
    },
    {
      key: 'fecha_emision',
      label: 'Fecha de emisión',
      prompt:
        'Mira la imagen adjunta. ¿Qué fecha de emisión o de facturación aparece en este comprobante? Responde solamente con esa fecha, copiada tal como aparece impresa, sin agregar nada más. Si no ves ninguna fecha, responde exactamente: no_visible'
    }
  ],
  formulario_apertura_cuenta: [
    {
      key: 'nombre_solicitante',
      label: 'Nombre del solicitante',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es el nombre completo del solicitante que aparece en este formulario de apertura de cuenta bancaria? Responde solamente con el nombre, copiado tal como aparece impreso, sin agregar nada más. Si no ves ningún nombre, responde exactamente: no_visible'
    },
    {
      key: 'numero_documento',
      label: 'Cédula del solicitante',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es el número de cédula o identificación del solicitante que aparece en este formulario? Responde solamente con ese número, copiado tal como aparece impreso, sin agregar nada más. Si no lo ves, responde exactamente: no_visible'
    },
    {
      key: 'tipo_cuenta',
      label: 'Tipo de cuenta',
      prompt:
        'Mira la imagen adjunta. ¿Qué tipo de cuenta se está solicitando en este formulario (por ejemplo, cuenta de ahorros o cuenta corriente)? Responde solamente con esas palabras, copiadas tal como aparecen marcadas o impresas, sin agregar nada más. Si no lo ves, responde exactamente: no_visible'
    },
    {
      key: 'fecha_solicitud',
      label: 'Fecha de solicitud',
      prompt:
        'Mira la imagen adjunta. ¿Qué fecha de solicitud o de llenado aparece en este formulario? Responde solamente con esa fecha, copiada tal como aparece impresa, sin agregar nada más. Si no ves ninguna fecha, responde exactamente: no_visible'
    }
  ],
  otro: [
    {
      key: 'nombre',
      label: 'Nombre',
      prompt:
        'Mira la imagen adjunta. ¿Cuál es el nombre completo de la persona escrito en el documento, si aparece alguno? Responde solamente con el nombre, copiado tal como aparece impreso, sin agregar nada más. Si no ves ningún nombre, responde exactamente: no_visible'
    },
    {
      key: 'numero_documento',
      label: 'Número de referencia',
      prompt:
        'Mira la imagen adjunta. ¿Aparece algún número de documento, cuenta o referencia en la imagen? Responde solamente con ese número, copiado tal como aparece impreso, sin agregar nada más. Si no lo ves, responde exactamente: no_visible'
    }
  ]
}

export type StreamHandlers = {
  onToken?: (token: string) => void
  onPlan?: (fields: { key: string; label: string }[]) => void
  onFieldStart?: (key: string) => void
  onFieldDone?: (key: string, value: string) => void
}

// El modelo a veces no copia el literal exacto "no_visible" que le pedimos
// (responde "no", "no visible", "ninguna", "n/a", etc.) aunque el sentido
// sea el mismo. Normalizamos todas esas variantes a un único valor canónico
// para que tanto la UI ("no visible en el documento") como la plantilla de
// explicación (que filtra campos "no_visible") lo reconozcan igual.
const NO_VISIBLE_PATTERN = /^(no[_\s-]?visible(\s+en\s+el\s+documento)?|no|ninguna?|n\/?a)\.?$/i

// Red de seguridad extra: cuando un prompt le exige al modelo condiciones
// más específicas (ej. un formato exacto), a veces en vez de responder
// "no_visible" se pone a "razonar" en una oración completa que empieza con
// "No, la imagen no parece..." -- eso no calza con NO_VISIBLE_PATTERN (que
// solo reconoce la palabra sola) y se mostraba tal cual como si fuera un
// dato real. Cualquier respuesta que arranque con la palabra "no" como
// palabra completa (no solo como prefijo de otra palabra, ej. "noviembre")
// se trata igual como "no_visible", sea cual sea el resto de la oración.
const STARTS_WITH_NO_PATTERN = /^no\b/i

function cleanFieldAnswer(raw: string): string {
  const withoutTags = raw
    // Algunos modelos "razonadores" a veces emiten un pseudo-tag de
    // pensamiento (p.ej. "<think>") en vez de responder directo, sobre
    // todo cuando el prompt es más largo o la imagen los confunde. Se
    // quita cualquier cosa entre <...> antes de seguir limpiando.
    .replace(/<[^>]*>/g, ' ')
  const firstNonEmptyLine = withoutTags
    .split('\n')
    // Además de comillas sueltas, a veces el modelo envuelve la respuesta
    // en marcado tipo markdown (_cuenta de ahorros_, *cuenta de ahorros*,
    // `cuenta de ahorros`) aunque el prompt le pida solo el texto plano.
    // Se quita cualquier combinación de esos caracteres al inicio/final.
    .map((line) => line.trim().replace(/^["'*_`\s]+|["'*_`\s]+$/g, ''))
    .find((line) => line.length > 0)
  const cleaned = (firstNonEmptyLine ?? '').trim()
  if (!cleaned || NO_VISIBLE_PATTERN.test(cleaned) || STARTS_WITH_NO_PATTERN.test(cleaned)) {
    return 'no_visible'
  }
  return cleaned
}

async function runFieldQuestion(
  id: string,
  imagePath: string,
  field: FieldDef,
  handlers: StreamHandlers
): Promise<{ value: string; stats: PerfLogEntry }> {
  handlers.onFieldStart?.(field.key)
  const start = Date.now()
  const result = completion({
    modelId: id,
    history: [
      {
        role: 'user',
        content: field.prompt,
        attachments: [{ path: imagePath }]
      }
    ],
    stream: true
  })

  let raw = ''
  for await (const token of result.tokenStream) {
    raw += token
    handlers.onToken?.(token)
  }
  const stats = await result.stats
  const wallTimeMs = Date.now() - start
  const value = cleanFieldAnswer(raw)
  handlers.onFieldDone?.(field.key, value)

  const entry: PerfLogEntry = {
    ts: new Date().toISOString(),
    op: 'extract',
    modelId: id,
    promptTokens: stats?.promptTokens,
    generatedTokens: stats?.generatedTokens,
    timeToFirstTokenMs: stats?.timeToFirstToken,
    tokensPerSecond: stats?.tokensPerSecond,
    backendDevice: stats?.backendDevice,
    wallTimeMs
  }
  recordPerf(entry)
  return { value, stats: entry }
}

export async function extractDocument(
  imagePath: string,
  docType: DocType,
  handlers: StreamHandlers = {}
): Promise<{ fields: Record<string, string>; stats: PerfLogEntry }> {
  const { modelId: id } = await ensureModelLoaded()
  const overallStart = Date.now()

  // El tipo de documento ya lo eligió el usuario en la UI (ver comentario
  // arriba de DocType) -- no hace falta preguntárselo al modelo. Se guarda
  // directo en el resultado para que el resto del pipeline (la tarjeta de
  // resultado y la explicación en lenguaje simple) lo use igual que antes.
  const fields: Record<string, string> = { tipo_documento: docType }

  // Avisarle a la UI el plan completo de campos para este tipo de
  // documento, para que pueda dibujar de una vez todas las filas
  // "esperando" con las etiquetas correctas.
  const plan = FIELD_SETS[docType]
  handlers.onPlan?.(plan.map(({ key, label }) => ({ key, label })))

  let lastStats: PerfLogEntry | undefined

  // Una pregunta por campo, específica para este tipo de documento.
  for (const field of plan) {
    const { value, stats } = await runFieldQuestion(id, imagePath, field, handlers)
    fields[field.key] = value
    lastStats = stats
  }

  const overallEntry: PerfLogEntry = {
    ...(lastStats as PerfLogEntry),
    wallTimeMs: Date.now() - overallStart
  }

  return { fields, stats: overallEntry }
}

const DOC_TYPE_EXPLANATIONS: Record<string, string> = {
  cedula:
    'es un documento de identidad. Sirve para confirmar quién eres en trámites bancarios, como abrir una cuenta o verificar tu identidad.',
  comprobante_domicilio:
    'es un comprobante de domicilio. Sirve para confirmar dónde vives, algo que los bancos piden para abrir cuentas o actualizar tus datos.',
  formulario_apertura_cuenta:
    'es un formulario de apertura de cuenta. Es el documento que se llena para solicitar una cuenta nueva en el banco.',
  otro: 'es un documento bancario. No se pudo identificar con certeza el tipo exacto, pero puede formar parte de un trámite.'
}

/**
 * VisionPsy-Nano-460M (460M parámetros) responde muy bien a UNA pregunta
 * puntual — por eso la extracción campo por campo funciona — pero en
 * pruebas reales fue poco confiable generando prosa libre de varias frases:
 * devolvía texto incoherente, o volvía a estructuras tipo JSON aunque se le
 * pidiera explícitamente que no lo hiciera. Insistir con más prompt
 * engineering sobre un modelo tan chico, para una función secundaria (la
 * explicación es un extra sobre la extracción, que es el corazón del
 * producto), no daba un resultado confiable a tiempo para la demo.
 *
 * En vez de eso, la explicación se arma acá con una plantilla fija por tipo
 * de documento, personalizada con los datos REALES que sí extrajo el modelo
 * (nombre, tipo). Sigue siendo 100% on-device — no hay ninguna llamada de
 * red ni de inferencia adicional acá — y siempre produce una frase
 * coherente en español, sin el riesgo de que el modelo alucine texto.
 */
// Los 3 tipos de documento usan distintas claves para "el nombre de la
// persona" (nombre / nombre_titular / nombre_solicitante) — se revisan en
// orden hasta encontrar la primera que tenga un valor real.
const NAME_FIELD_KEYS = ['nombre', 'nombre_titular', 'nombre_solicitante']

export function explainSimple(
  fields: Record<string, string>,
  handlers: StreamHandlers = {}
): { text: string; stats: PerfLogEntry } {
  const start = Date.now()

  const tipoRaw = fields.tipo_documento
  const tipo = tipoRaw && tipoRaw !== 'no_visible' ? tipoRaw : 'otro'
  const base = DOC_TYPE_EXPLANATIONS[tipo] ?? DOC_TYPE_EXPLANATIONS.otro
  const nombreKey = NAME_FIELD_KEYS.find((key) => fields[key] && fields[key] !== 'no_visible')
  const nombre = nombreKey ? fields[nombreKey] : null

  const text = nombre ? `Este documento pertenece a ${nombre} y ${base}` : `Este documento ${base}`

  handlers.onToken?.(text)

  const entry: PerfLogEntry = {
    ts: new Date().toISOString(),
    op: 'explain',
    modelId: modelId ?? undefined,
    wallTimeMs: Date.now() - start
  }
  recordPerf(entry)

  return { text, stats: entry }
}

export async function shutdownModel(): Promise<void> {
  if (modelId) {
    await unloadModel({ modelId })
    modelId = null
    modelLoadedAt = null
  }
}

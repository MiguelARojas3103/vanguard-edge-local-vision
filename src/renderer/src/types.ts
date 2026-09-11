export type PerfEntry = {
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

// Los campos que trae cada documento se deciden dinámicamente en el proceso
// principal según el tipo elegido por el usuario (ver FIELD_SETS en
// src/main/qvac.ts) y llegan acá vía el evento "plan" antes de que empiecen
// a llenarse — la UI no necesita conocer de antemano qué campos tiene cada
// tipo de documento.
export type FieldDef = { key: string; label: string }

// El usuario elige el tipo de documento ANTES de subir la imagen (ver el
// comentario en src/main/qvac.ts sobre por qué se dejó de pedirle al modelo
// que lo adivinara). Solo se ofrecen los 3 tipos reales de la demo —
// 'otro' sigue existiendo en el lado del modelo como resultado interno,
// pero no es una opción seleccionable.
export type SelectableDocType = 'cedula' | 'comprobante_domicilio' | 'formulario_apertura_cuenta'

export const DOC_TYPE_OPTIONS: { value: SelectableDocType; label: string; icon: string }[] = [
  { value: 'cedula', label: 'Cédula de identidad', icon: '🪪' },
  { value: 'comprobante_domicilio', label: 'Comprobante de domicilio', icon: '🏠' },
  { value: 'formulario_apertura_cuenta', label: 'Formulario de apertura', icon: '🏦' }
]

export const DOC_TYPE_LABELS: Record<string, string> = {
  cedula: 'Cédula de identidad',
  comprobante_domicilio: 'Comprobante de domicilio',
  formulario_apertura_cuenta: 'Formulario de apertura de cuenta',
  otro: 'Documento bancario'
}

export const DOC_TYPE_ICONS: Record<string, string> = {
  cedula: '🪪',
  comprobante_domicilio: '🏠',
  formulario_apertura_cuenta: '🏦',
  otro: '📄'
}

export type Stage =
  | 'loadingModel'
  | 'idle'
  | 'extracting'
  | 'extracted'
  | 'explaining'
  | 'done'
  | 'error'

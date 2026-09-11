type Props = {
  netEventsDuringLastOp: number | null
}

export default function PrivacyBadge({ netEventsDuringLastOp }: Props): JSX.Element {
  const clean = netEventsDuringLastOp === 0
  const state =
    netEventsDuringLastOp === null ? 'neutral' : clean ? 'ok' : 'warn'
  return (
    <div className={`privacy-badge privacy-badge--${state}`}>
      <span className="privacy-dot" />
      <div>
        <div className="privacy-title">
          {netEventsDuringLastOp === null
            ? 'Aún sin medir'
            : clean
              ? '0 bytes salientes durante la inferencia'
              : `${netEventsDuringLastOp} solicitud(es) de red detectadas`}
        </div>
      </div>
    </div>
  )
}

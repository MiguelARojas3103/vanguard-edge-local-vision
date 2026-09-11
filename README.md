# Vanguard Edge Local Vision (VELV)

Lectura y explicación de documentos bancarios 100% en el dispositivo, sin que ninguna imagen ni dato salga jamás del equipo. Construido para el **Decentralized AI Hackathon**.

## Compite en:

Track 03 — Desafío General (Sovereign Intelligence at the Edge)

Track 02 — Reto Tether: QVAC Psy (VisionPsy)

Track 05 — Reto Caja de Ahorros (IA descentralizada para banca)

## Qué hace

1. El usuario elige qué tipo de documento va a leer (cédula, comprobante de domicilio o formulario de apertura de cuenta) y selecciona la imagen. Elegir el tipo a mano, en vez de pedírselo al modelo, fue una decisión deliberada: en pruebas reales un modelo de clasificación automática con VisionPsy-Nano-460M (460M parámetros) resultó poco confiable para comparar la imagen contra categorías — un modelo tan chico sostiene mucho mejor una pregunta puntual por campo que una tarea de clasificación.

2. **QVAC VisionPsy-Nano-460M** (modelo Psy oficial de Tether, multimodal, cuantizado GGUF) lee la imagen localmente, campo por campo: una llamada de `completion()` por cada campo relevante para el tipo de documento elegido (nombre, número de documento, dirección, etc.), siempre con la misma imagen adjunta. El objeto estructurado se arma en código a partir de esas respuestas — nunca se le pide al modelo un JSON completo de una sola vez, algo que también resultó poco confiable en pruebas reales con un modelo tan pequeño.

3. La explicación en lenguaje simple se arma con una plantilla determinística en código, personalizada con los datos reales que sí extrajo el modelo (no es una llamada adicional al modelo) — en pruebas reales, pedirle a VisionPsy-Nano-460M prosa libre de varias frases fue poco confiable.

4. Un panel de rendimiento en vivo muestra tiempo de carga del modelo, TTFT, tokens/segundo y backend usado (CPU/GPU) — y los mismos datos quedan en un log estructurado (`~/Library/Application Support/doclocal/performance-logs/perf-log.jsonl` en macOS, o el equivalente de `app.getPath('userData')` en cada plataforma).

5. Un monitor de red integrado en el proceso de Electron cuenta cada solicitud saliente del proceso. Durante la extracción y la explicación, ese contador se muestra en pantalla: si marca 0, ninguna inferencia salió del dispositivo. Es la prueba de privacidad, no solo la promesa.

**Ningún documento ni dato del usuario se envía a un servidor.** La única actividad de red que la app puede llegar a generar es la descarga puntual de los pesos del modelo la primera vez que se ejecuta (eso no es inferencia — es la única razón permitida por el artículo 10 de las bases para tocar red). Una vez descargado el modelo queda cacheado localmente y la app funciona completamente offline, incluso con el wifi apagado.

## Requisito técnico

Toda la inferencia corre sobre `@qvac/sdk`, en el proceso principal de Electron, invocando el motor `llamacpp-completion` local. No hay ningún `fetch`/`http` hacia un endpoint de inferencia en la nube en ningún punto del código. El único uso de red permitido (descarga de pesos, no inferencia) está aislado en `ensureModelLoaded()` (`src/main/qvac.ts`).

## Modelo usado

| | |
|---|---|
| Modelo | `VisionPsy-Nano-460M` (variante Flash) |
| Cuantización | `Q4_K_M` (modelo principal) + proyección `Q8_0` |
| Fuente de descarga | HTTPS directo a Hugging Face (`qvac/VisionPsy-Nano-460M-Flash-GGUFs`) — ver nota abajo |
| Motor | `llamacpp-completion` (GGUF, local) vía `@qvac/sdk` v0.19.0 |
| Hardware de desarrollo/demo | Laptop Windows 11 Home · CPU Intel(R) Core(TM) i5-10500H @ 2.50GHz · GPU NVIDIA GeForce GTX 1650 with Max-Q Design · 16 GB RAM. La inferencia corre sobre la GPU (`backend: gpu`, confirmado en el panel de rendimiento de la propia app). |

**Nota sobre la descarga del modelo:** el SDK ofrece constantes de registro (`VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M`) que bajan el modelo por un protocolo P2P propio (Hypercore/Hyperswarm). En pruebas reales ese camino dio timeout de forma consistente (`REQUEST_TIMEOUT`) en dos redes distintas — es una capa muy nueva del propio SDK (v0.19.0). Siguiendo la sugerencia del mensaje de error del SDK, `src/main/qvac.ts` apunta en su lugar directo a la URL HTTPS de Hugging Face que esa misma constante resuelve internamente. La inferencia sigue siendo 100% local — este cambio solo afecta cómo se bajan los pesos una vez, no dónde corre el modelo.

## Base preexistente utilizada

Todo lo construido dentro de las 48 horas de competencia. Se apoya en:

- **`@qvac/sdk`** (`v0.19.0`, Apache-2.0) — SDK oficial de Tether/QVAC para inferencia local. Es el requisito técnico de la competencia, no una base sustituida.
- **Electron** (`^44`) + **electron-vite** (`^5`) — armazón estándar de aplicación de escritorio; patrón de estructura main/preload/renderer tomado del [tutorial oficial de QVAC para Electron](https://docs.qvac.tether.io/tutorials/electron/).
- **React 18** + **TypeScript** — UI del renderer.
- Ningún componente de UI, extracción, explicación, panel de rendimiento o monitor de red proviene de una plantilla o proyecto preexistente: todo el código de `src/` se escribió durante la ventana de competencia.
- No se usaron datos reales de clientes de ningún banco: todas las imágenes de prueba usadas en la demo son documentos ficticios/sintéticos creados para este proyecto.

## Instalación y ejecución (reproducibilidad)

Requisitos: Node.js ≥ 18 (probado con Node 22), npm, ~5 GB de espacio libre para los pesos del modelo la primera vez que se descargan.

```bash
npm install
npm run dev
```

La primera vez que se ejecuta, la app descarga los pesos de `VisionPsy-Nano-460M` (una sola vez, se cachea localmente). A partir de ahí puede correr completamente sin conexión.

Build de producción:

```bash
npm run build
```

## Estructura del proyecto

```
src/
  main/
    index.ts            # ventana de Electron + handlers IPC
    qvac.ts              # carga del modelo, extracción, explicación, log de rendimiento
    network-monitor.ts   # prueba de privacidad: cuenta solicitudes de red salientes
  preload/
    index.ts             # bridge IPC seguro expuesto como window.doclocal
  renderer/
    src/
      App.tsx             # UI principal
      components/         # panel de privacidad, panel de rendimiento
```

## Licencia

MIT (ver `LICENSE`) — cumple el requisito de licencia permisiva del Track 02.

## Video de demostración

https://youtu.be/RDve2YuQkP0
